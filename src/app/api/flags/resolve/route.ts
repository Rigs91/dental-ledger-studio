import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';

const schema = z.object({
  flagId: z.string(),
  status: z.enum(['RESOLVED', 'VERIFIED']),
  resolutionNote: z.string().min(3)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { flagId, status, resolutionNote } = parsed.data;
  const flag = await prisma.flag.findUnique({ where: { id: flagId } });
  if (!flag) {
    return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
  }

  await prisma.flag.update({
    where: { id: flagId },
    data: {
      status,
      resolutionNote,
      resolvedAt: new Date()
    }
  });

  return NextResponse.json({ ok: true });
}

