// POST — Full optimization pipeline endpoint (streamed stages)
import { headers } from 'next/headers';
import { optimize } from '@/lib/optimizer';
import type { Hotspot } from '@/types';
import hotspotData from '@/data/hotspots-nyc.json';

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { people, objective, alpha, departureTime } = body;
  if (!people?.length || people.length < 2) {
    return Response.json({ error: 'At least 2 people required' }, { status: 400 });
  }
  if (people.length > 6) {
    return Response.json({ error: 'Maximum 6 people' }, { status: 400 });
  }

  const hotspots = hotspotData as Hotspot[];

  if (hotspots.length === 0) {
    return Response.json({ error: 'Hotspot corpus not available', rankings: [], venues: [], candidateDetails: [], stages: [] });
  }

  // Stream results using SSE so the frontend can show stages in real-time
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: 'stage', stage: 'prefilter', detail: 'Analyzing locations...' });

        const result = await optimize({
          people,
          hotspots,
          objective: objective ?? 'blended',
          alpha: alpha ?? 0.7,
          departureTime: departureTime ?? 'now',
        });

        // Send each stage as it completed
        for (const s of result.stages) {
          if (s.stage !== 'done') {
            send({ type: 'stage', stage: s.stage, detail: s.detail, durationMs: s.durationMs });
          }
        }

        // Send final result
        send({
          type: 'result',
          rankings: result.rankings,
          venues: result.venues,
          candidateDetails: result.candidateDetails,
          usedHeuristic: result.usedHeuristic,
          stages: result.stages,
        });
      } catch (err) {
        console.error('Optimize error:', err);
        send({ type: 'error', error: 'Optimization failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
