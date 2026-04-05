import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';

const schema = z.object({
  explanationId: z.string(),
  editedText: z.string().min(3)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const explanation = await prisma.explanationDraft.findUnique({ where: { id: parsed.data.explanationId } });
  if (!explanation) {
    return NextResponse.json({ error: 'Explanation not found.' }, { status: 404 });
  }

  await prisma.explanationDraft.update({
    where: { id: parsed.data.explanationId },
    data: {
      editedText: parsed.data.editedText,
      status: 'FINAL'
    }
  });

  return NextResponse.json({ ok: true });
}

