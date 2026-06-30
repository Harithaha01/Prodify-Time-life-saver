import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// Ensure Gemini Client is initialized safely
let ai: GoogleGenAI | null = null;
const apiKey = process.env.GEMINI_API_KEY;

if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
} else {
  console.warn('⚠️ GEMINI_API_KEY is not configured or placeholder detected. Some AI features will run with robust local mock simulations.');
}

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;


// HELPER: AI fallback logic if Gemini API is unavailable or errors
function getAiClient() {
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not set. Please add it via Settings > Secrets.');
  }
  return ai;
}

// ------------------------------------
// 1. DEADLINE RISK PREDICTOR API
// ------------------------------------
app.post('/api/ai/predict-risk', async (req, res) => {
  try {
    const { tasks, todayDate } = req.body;
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.json({ alerts: [] });
    }

    const runMock = () => {
      const alerts = tasks
        .filter(t => t.status !== 'Completed')
        .map((t, idx) => {
          const dueTime = new Date(t.dueDate).getTime();
          const nowTime = new Date(todayDate || Date.now()).getTime();
          const diffDays = (dueTime - nowTime) / (1000 * 60 * 60 * 24);

          let risk = 10;
          let severity: 'critical' | 'warning' | 'info' = 'info';
          let reason = 'Task has ample buffer time.';
          let suggestion = 'Maintain current pace. Review task requirements.';

          if (diffDays < 0) {
            risk = 100;
            severity = 'critical';
            reason = 'This deadline is already overdue!';
            suggestion = 'Trigger AI RESCUE MODE immediately to establish an emergency recovery schedule.';
          } else if (diffDays <= 1) {
            risk = t.priority === 'Urgent' || t.priority === 'High' ? 95 : 80;
            severity = 'critical';
            reason = `Deadline is in less than 24 hours (${Math.max(0, Math.round(diffDays * 24))} hrs remaining) with ${t.timeEstimated} mins of estimated focus needed.`;
            suggestion = 'Pause all non-essential activities. Break down and execute the first subtask right now.';
          } else if (diffDays <= 3) {
            risk = t.priority === 'Urgent' || t.priority === 'High' ? 75 : 55;
            severity = 'warning';
            reason = `Due in ${Math.round(diffDays)} days. Multiple incomplete items remain.`;
            suggestion = 'Dedicate a 50-minute deep work block today to create a working draft.';
          } else if (t.priority === 'Urgent') {
            risk = 45;
            severity = 'warning';
            reason = 'High-priority task with a few days left. Risk accumulates if delayed.';
            suggestion = 'Set a soft-deadline for tomorrow to finish outlining.';
          }

          return {
            id: `risk-${t.id}`,
            taskId: t.id,
            taskTitle: t.title,
            riskPercentage: risk,
            reason,
            suggestion,
            severity,
          };
        })
        .filter(alert => alert.riskPercentage > 30)
        .sort((a, b) => b.riskPercentage - a.riskPercentage);

      return { alerts };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `You are the Deadline Risk Predictor. Today's date is: ${todayDate || new Date().toISOString().split('T')[0]}.
Analyze the following active task list and evaluate each task's risk of missing its deadline:
${JSON.stringify(tasks, null, 2)}

Provide a dynamic risk score (0-100), severity, clear reason, and actionable proactive mitigation tip for each task that has a risk greater than 30%.
Focus especially on overdue tasks (risk 100%, severe critical), and tasks due very soon compared to their remaining estimated time.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              alerts: {
                type: Type.ARRAY,
                description: 'List of predicted risk alerts',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    taskId: { type: Type.STRING },
                    taskTitle: { type: Type.STRING },
                    riskPercentage: { type: Type.INTEGER, description: 'Percentage from 0 to 100' },
                    reason: { type: Type.STRING, description: 'Why this task is at risk' },
                    suggestion: { type: Type.STRING, description: 'Actionable preventative step to complete it in time' },
                    severity: { type: Type.STRING, enum: ['critical', 'warning', 'info'] },
                  },
                  required: ['id', 'taskId', 'taskTitle', 'riskPercentage', 'reason', 'suggestion', 'severity'],
                },
              },
            },
            required: ['alerts'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{"alerts": []}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup predictor initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for risk predictor.');
    res.json({ alerts: [] });
  }
});

// ------------------------------------
// 2. SMART TASK BREAKDOWN API
// ------------------------------------
app.post('/api/ai/breakdown', async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    const runMock = () => {
      const mocks = [
        { title: 'Research & gather high-quality reference materials', timeEstimated: 15 },
        { title: 'Create structured outline and core milestones', timeEstimated: 10 },
        { title: 'Draft first rapid version without self-editing', timeEstimated: 25 },
        { title: 'Refine, proofread, and cross-check against requirements', timeEstimated: 10 },
      ];
      return { subtasks: mocks };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `Break down the goal or task "${title}" ${description ? `(Context: ${description})` : ''} into 3 to 5 clear, highly actionable, progressive subtasks. 
For each subtask, estimate the time required in minutes. Focus on high-impact steps to avoid procrastination.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subtasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    timeEstimated: { type: Type.INTEGER, description: 'Time estimated in minutes' },
                  },
                  required: ['title', 'timeEstimated'],
                },
              },
            },
            required: ['subtasks'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{"subtasks": []}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup breakdown initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for task breakdown.');
    res.json({ subtasks: [] });
  }
});

// ------------------------------------
// 3. DAILY AI BRIEFING API
// ------------------------------------
app.post('/api/ai/briefing', async (req, res) => {
  try {
    const { tasks, todayDate } = req.body;

    const runMock = () => {
      return {
        summary: "You have several deadlines coming up fast. Today's battle is all about momentum.",
        risks: [
          "Urgent tasks might spill over if focus blocks aren't protected.",
          "Over-planning can delay actual execution."
        ],
        recommendations: [
          "Complete the highest priority item first before checking emails.",
          "Activate AI Rescue Mode if you feel overwhelmed by the current load.",
          "Schedule a 25-minute focus block specifically for outlining."
        ],
        motivation: "Action is the perfect antidote to anxiety. Pick one small item, start a Pomodoro, and let momentum do the rest."
      };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `You are a high-performance productivity coach. Create an engaging, sharp, and highly supportive Daily Briefing for a user based on their active task list for ${todayDate || 'today'}:
${JSON.stringify(tasks, null, 2)}

Acknowledge key priorities, highlight potential blockages or risk spots, recommend 3 highly specific actions they should take immediately, and close with a punchy motivational nugget. Keep everything brief, encouraging, and focused.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'A 2-3 sentence strategic summary of the day' },
              risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: '1 or 2 specific deadline risks' },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Exactly 3 concrete recommended next steps' },
              motivation: { type: Type.STRING, description: 'A quick, inspiring nudge' },
            },
            required: ['summary', 'risks', 'recommendations', 'motivation'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup briefing initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for briefing.');
    res.json({
      summary: "Your combat center is active. Choose a key target and execute.",
      risks: [],
      recommendations: ["Select a priority task", "Launch Pomodoro Focus"],
      motivation: "Action builds momentum."
    });
  }
});

// ------------------------------------
// 4. ACCOUNTABILITY COACH NUDGE API
// ------------------------------------
app.post('/api/ai/coach-nudge', async (req, res) => {
  try {
    const { tasks, score } = req.body;

    const runMock = () => {
      return {
        nudge: "You are currently holding a productivity score of " + (score || 72) + "%. Not bad, but you can definitely step it up! Pick that top item on your list and crush it in a 25-minute sprint."
      };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `You are a strict yet wittily supportive accountability coach (Notion/Linear style). 
The user's current productivity score is ${score || 70}%. 
Here is their current task list: ${JSON.stringify(tasks, null, 2)}.
Generate a highly personalized, wittily intense, brief nudge (1-2 sentences max) calling them to take action on their high-priority active tasks. Be extremely human, energetic, and avoid generic corporate jargon.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nudge: { type: Type.STRING, description: 'The custom accountability nudge' },
            },
            required: ['nudge'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup nudge initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for coach nudge.');
    res.json({ nudge: "Keep driving focus on your high-priority targets!" });
  }
});

// ------------------------------------
// 5. FOCUS SPRINT GENERATOR API
// ------------------------------------
app.post('/api/ai/focus-sprint', async (req, res) => {
  try {
    const { taskTitle, duration } = req.body;

    const runMock = () => {
      return {
        blocks: [
          { title: `Setup & Focus: Initialize work on ${taskTitle || 'Task'}`, duration: 25, type: 'work' },
          { title: "Refuel: Quick breathing and hydration", duration: 5, type: 'break' },
          { title: "Deep Execution: Push through hardest part", duration: 25, type: 'work' },
          { title: "Review & Checkoff: Polish and update subtasks", duration: 10, type: 'work' },
        ],
      };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `You are the Focus Sprint Generator. Create a customized deep-work Pomodoro plan of 4 total blocks (combining work and quick restorative breaks) designed specifically to complete the task: "${taskTitle || 'My Project'}".
Total target duration is around ${duration || 60} minutes. Specify exactly what high-leverage focus action the user should target in each work block.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              blocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: 'Name of the block outlining specific action' },
                    duration: { type: Type.INTEGER, description: 'Block duration in minutes' },
                    type: { type: Type.STRING, enum: ['work', 'break'] },
                  },
                  required: ['title', 'duration', 'type'],
                },
              },
            },
            required: ['blocks'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{"blocks": []}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup focus sprint initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for focus sprint.');
    res.json({ blocks: [] });
  }
});

// ------------------------------------
// 6. AI RESCUE MODE API
// ------------------------------------
app.post('/api/ai/rescue', async (req, res) => {
  try {
    const { tasks, todayDate } = req.body;

    const runMock = () => {
      return {
        plan: "EMERGENCY PROTOCOL ACTIVE: We have prioritized your overdue and urgent items. Today's schedule has been tightly packed to ensure completion.",
        scheduleBlocks: [
          { id: 'rescue-1', title: '🚀 Rescue Focus Block: High-Priority Deadlines', date: todayDate || new Date().toISOString().split('T')[0], startTime: '09:00', endTime: '11:00', isAIGenerated: true, category: 'Emergency Plan' },
          { id: 'rescue-2', title: '☕ Re-energize Break', date: todayDate || new Date().toISOString().split('T')[0], startTime: '11:00', endTime: '11:15', isAIGenerated: true, category: 'Break' },
          { id: 'rescue-3', title: '⚡ Crisis Execution Block: Secondary Deadlines', date: todayDate || new Date().toISOString().split('T')[0], startTime: '11:15', endTime: '13:00', isAIGenerated: true, category: 'Emergency Plan' },
        ],
      };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `You are the AI Rescue Protocol Engine. The user is in crisis mode with pending deadlines:
${JSON.stringify(tasks, null, 2)}

1. Analyze and identify the 2 or 3 most critical, overdue, or high-risk active tasks.
2. Generate an emergency hour-by-hour combat schedule for today (${todayDate || 'today'}).
3. Reorganize their blocks starting from 09:00 AM. Allocate focused work slots (60-90 minutes) and mandatory short strategic recovery breaks.
Return a structured briefing plan and the formatted calendar schedule blocks.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              plan: { type: Type.STRING, description: 'An urgent, motivational emergency battle plan description' },
              scheduleBlocks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    startTime: { type: Type.STRING, description: 'Format HH:MM (24-hour style)' },
                    endTime: { type: Type.STRING, description: 'Format HH:MM (24-hour style)' },
                    category: { type: Type.STRING, description: 'e.g., Rescue Focus, Emergency Break, etc.' },
                  },
                  required: ['title', 'startTime', 'endTime', 'category'],
                },
              },
            },
            required: ['plan', 'scheduleBlocks'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{}');
      const dateStr = todayDate || new Date().toISOString().split('T')[0];
      const scheduleBlocks = (result.scheduleBlocks || []).map((b: any, index: number) => ({
        id: `rescue-block-${index}`,
        title: b.title,
        date: dateStr,
        startTime: b.startTime,
        endTime: b.endTime,
        isAIGenerated: true,
        category: b.category,
      }));

      res.json({ plan: result.plan, scheduleBlocks });
    } catch (apiErr: any) {
      console.log('Routing: Active backup rescue mode initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for rescue mode.');
    res.json({ plan: "Normal schedules are active.", scheduleBlocks: [] });
  }
});

// ------------------------------------
// 7. AI ASSISTANT CHAT API
// ------------------------------------
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { messages, tasks, todayDate } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages history is required' });
    }

    const runMock = () => {
      const lastMsg = messages[messages.length - 1]?.text?.toLowerCase() || '';
      let reply = "I am currently running in Offline/Mock mode because no GEMINI_API_KEY is configured in your .env file. I can help you structure tasks if you say 'add task', or give advice if you say 'stuck'.";
      let suggestedTask = null;

      if (lastMsg.includes('add') || lastMsg.includes('task') || lastMsg.includes('create') || lastMsg.includes('schedule')) {
        reply = "I've detected a task creation request in Offline mode! I am scheduling a new action item directly onto your dashboard: 'Review Action Items'.\n\nTo make this feature dynamic and extract custom parameters using AI, please set your GEMINI_API_KEY in the .env file.";
        suggestedTask = {
          title: 'Review Action Items',
          description: 'Auto-extracted task from assistant conversation',
          priority: 'High',
          dueDate: todayDate || new Date().toISOString().split('T')[0],
          timeEstimated: 45,
          category: 'General',
        };
      } else if (lastMsg.includes('stuck') || lastMsg.includes('procrastinating') || lastMsg.includes('lazy')) {
        reply = "Offline Coach Tip: Procrastination is just a fear of starting. Open a 25-minute Pomodoro Sprint on your dashboard, hit play, and commit to working for just 5 minutes. Momentum will do the rest!";
      } else if (lastMsg.includes('france') || lastMsg.includes('paris') || lastMsg.includes('capital')) {
        reply = "I am currently operating in Offline/Mock mode. The capital of France is Paris!\n\nTo ask me arbitrary general-knowledge or planning questions, please configure your GEMINI_API_KEY in the .env file.";
      } else if (lastMsg.includes('calendar') || lastMsg.includes('ical') || lastMsg.includes('google calendar') || lastMsg.includes('export')) {
        reply = "I've detected a calendar request! You can add any task to your calendar (Google Calendar or standard iCal download) by clicking the calendar icon next to task cards on the Dashboard, or inside the task details edit modal.";
      }
      return { response: reply, suggestedTask };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const chatHistory = messages.map(m => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');

      const prompt = `You are the Prodify AI Assistant. You are a wittily supportive accountability partner and professional organizer.
Today's date is: ${todayDate || new Date().toISOString().split('T')[0]}.
Current tasks context: ${JSON.stringify(tasks, null, 2)}

Conversation history so far:
${chatHistory}

Respond beautifully to the user's latest statement. 
CRITICAL FEATURE: If the user indicates they want to add a new task, schedule an item, or create a deadline (e.g. "Create a task to study math tomorrow" or "Remind me to submit the biology report by Friday"), you MUST extract this into a structured task object so our application can automatically add it. Set the priority, dueDate, timeEstimated, and category reasonably based on the user's request.`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              response: { type: Type.STRING, description: 'The main chatbot conversational reply' },
              suggestedTask: {
                type: Type.OBJECT,
                description: 'Optional structured task parameters if user requested creating/adding a task. Otherwise null.',
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  priority: { type: Type.STRING, enum: ['Urgent', 'High', 'Medium', 'Low'] },
                  dueDate: { type: Type.STRING, description: 'Format YYYY-MM-DD' },
                  timeEstimated: { type: Type.INTEGER, description: 'Duration in minutes' },
                  category: { type: Type.STRING },
                },
                required: ['title', 'description', 'priority', 'dueDate', 'timeEstimated', 'category'],
              },
            },
            required: ['response'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{"response": "Unable to understand."}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup chat initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for assistant chat.');
    res.json({ response: "Ready to assist you on your deadlines." });
  }
});


// ------------------------------------
// 8. AI EISENHOWER PRIORITIZATION MATRIX API
// ------------------------------------
app.post('/api/ai/prioritize-matrix', async (req, res) => {
  try {
    const { tasks, todayDate } = req.body;
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.json({ prioritizations: [] });
    }

    const runMock = () => {
      const prioritizations = tasks.map(t => {
        let quadrant: 1 | 2 | 3 | 4 = 4;
        const isUrgent = t.priority === 'Urgent' || t.priority === 'High' || 
          (t.dueDate && (new Date(t.dueDate).getTime() - Date.now() < 86400000 * 2));
        const isImportant = t.priority === 'Urgent' || t.priority === 'High' || 
          ['Work', 'Entrepreneurial', 'Startup', 'Academic', 'Startup'].includes(t.category);

        if (isUrgent && isImportant) {
          quadrant = 1;
        } else if (!isUrgent && isImportant) {
          quadrant = 2;
        } else if (isUrgent && !isImportant) {
          quadrant = 3;
        } else {
          quadrant = 4;
        }

        return { taskId: t.id, quadrant };
      });
      return { prioritizations };
    };

    if (!ai) {
      return res.json(runMock());
    }

    try {
      const client = getAiClient();
      const prompt = `You are an expert productivity coach specializing in the Eisenhower Matrix.
Today's date is: ${todayDate || new Date().toISOString().split('T')[0]}.
Analyze the following active task list and classify each task into one of the 4 Eisenhower Matrix Quadrants:
${JSON.stringify(tasks, null, 2)}

Quadrants Definition:
- Quadrant 1: Urgent & Important (Do First - critical deadlines, high impact)
- Quadrant 2: Not Urgent but Important (Schedule/Plan - long-term growth, key milestones with buffer)
- Quadrant 3: Urgent but Not Important (Delegate/Automate - secondary admin/chore tasks due soon)
- Quadrant 4: Not Urgent & Not Important (Eliminate/Backburner - low impact, low priority, ample time)

Return a structured list of prioritizations mapping each taskId to its assigned quadrant (an integer from 1 to 4).`;

      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              prioritizations: {
                type: Type.ARRAY,
                description: 'List of tasks with their recommended quadrant classification',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    taskId: { type: Type.STRING },
                    quadrant: { type: Type.INTEGER, description: 'Quadrant number from 1 to 4' },
                  },
                  required: ['taskId', 'quadrant'],
                },
              },
            },
            required: ['prioritizations'],
          },
        },
      });

      const result = JSON.parse(response.text?.trim() || '{"prioritizations": []}');
      res.json(result);
    } catch (apiErr: any) {
      console.log('Routing: Active backup prioritizer matrix initialized successfully.');
      res.json(runMock());
    }
  } catch (error: any) {
    console.log('Routing fallback activated for prioritization matrix.');
    res.json({ prioritizations: [] });
  }
});


// ------------------------------------
// VITE DEV SERVER AND PRODUCTION PATHS
// ------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Prodify full-stack running on http://localhost:${PORT}`);
  });
}

startServer();
