import { BadRequestException } from '@nestjs/common';

export interface ParsedMention { rawTarget: string; displayText: string | null; anchor: string | null; startOffset: number; endOffset: number }
export const normalizeKnowledgeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
export function parseMentions(content: string): ParsedMention[] {
  const matches = [...content.matchAll(/\[\[([^\r\n]{1,300}?)\]\]/g)];
  if (matches.length > 100) throw new BadRequestException('La nota admite hasta 100 enlaces internos.');
  return matches.map(match => {
    const [destination, ...display] = match[1]!.split('|');
    if (match[1]!.includes('[[')) throw new BadRequestException('Enlace interno inválido.');
    const [target, ...anchor] = destination!.split('#');
    const rawTarget = target!.trim();
    if (!rawTarget || rawTarget.length > 160 || display.join('|').length > 160 || anchor.join('#').length > 160) throw new BadRequestException('Enlace interno inválido o demasiado largo.');
    return { rawTarget, displayText: display.length ? display.join('|').trim() || null : null, anchor: anchor.length ? anchor.join('#').trim() || null : null, startOffset: match.index!, endOffset: match.index! + match[0].length };
  });
}
