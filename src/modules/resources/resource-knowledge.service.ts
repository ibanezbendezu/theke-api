import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ResourceKnowledgeRepository } from './resource-knowledge.repository.js';

type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime';
type InputProperty = { key?: unknown; type?: unknown; value?: unknown };
const allowedTypes: PropertyType[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];
function labels(value: unknown, name: string, max: number) {
  if (!Array.isArray(value) || value.length > max) throw new BadRequestException(`${name}: lista inválida o demasiado larga.`);
  const result = value.map(item => {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 80) throw new BadRequestException(`${name}: cada valor debe tener entre 1 y 80 caracteres.`);
    return item.trim().normalize('NFKC');
  });
  if (new Set(result.map(item => item.toLocaleLowerCase('es'))).size !== result.length) throw new BadRequestException(`${name}: hay valores repetidos.`);
  return result;
}
function validProperty(item: InputProperty): { key: string; type: PropertyType; value: string | number | boolean | string[] } {
  if (!item || typeof item !== 'object') throw new BadRequestException('Propiedad inválida.');
  const key = typeof item.key === 'string' ? item.key.trim().toLocaleLowerCase('es') : '';
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(key) || ['tags', 'aliases', 'id', 'type', 'title'].includes(key)) throw new BadRequestException('Nombre de propiedad inválido o reservado.');
  if (!allowedTypes.includes(item.type as PropertyType)) throw new BadRequestException(`Tipo inválido para ${key}.`);
  const type = item.type as PropertyType;
  let value: string | number | boolean | string[];
  if (type === 'list') value = labels(item.value, key, 20);
  else if (type === 'checkbox') { if (typeof item.value !== 'boolean') throw new BadRequestException(`${key} debe ser verdadero o falso.`); value = item.value; }
  else if (type === 'number') { if (typeof item.value !== 'number' || !Number.isFinite(item.value)) throw new BadRequestException(`${key} debe ser un número finito.`); value = item.value; }
  else {
    if (typeof item.value !== 'string' || item.value.length > 1000) throw new BadRequestException(`${key} debe ser texto de hasta 1000 caracteres.`);
    value = item.value.trim();
    if (type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) throw new BadRequestException(`${key} debe ser una fecha ISO.`);
    if (type === 'datetime' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || Number.isNaN(Date.parse(value)))) throw new BadRequestException(`${key} debe ser fecha y hora ISO.`);
  }
  return { key, type, value };
}

@Injectable()
export class ResourceKnowledgeService {
  constructor(@Inject(ResourceKnowledgeRepository) private readonly repository: ResourceKnowledgeRepository) {}
  definitions(accountId: string) { return this.repository.definitions(accountId); }
  references(accountId: string, id: string) { return this.repository.references(accountId, id); }
  async updateMetadata(accountId: string, id: string, input: { aliases?: unknown; tags?: unknown; properties?: unknown; expectedUpdatedAt?: unknown }) {
    if (!input || typeof input !== 'object') throw new BadRequestException('Metadatos inválidos.');
    const aliases = labels(input.aliases, 'Alias', 20);
    const tags = labels(input.tags, 'Etiquetas', 30).map(item => item.replace(/^#/, ''));
    if (tags.some(item => !/^[\p{L}\p{N}_/-]+$/u.test(item))) throw new BadRequestException('Las etiquetas solo admiten letras, números, guion bajo, barras y guiones.');
    if (new Set(tags.map(item => item.toLocaleLowerCase('es'))).size !== tags.length) throw new BadRequestException('Hay etiquetas repetidas.');
    if (!Array.isArray(input.properties) || input.properties.length > 30) throw new BadRequestException('Se admiten hasta 30 propiedades.');
    const properties = input.properties.map(value => validProperty(value as InputProperty));
    if (new Set(properties.map(item => item.key)).size !== properties.length) throw new BadRequestException('Hay propiedades repetidas.');
    const expectedUpdatedAt = typeof input.expectedUpdatedAt === 'string' ? new Date(input.expectedUpdatedAt) : new Date(NaN);
    if (Number.isNaN(expectedUpdatedAt.getTime())) throw new BadRequestException('Falta la versión esperada del Recurso.');
    const values = Object.fromEntries(properties.map(item => [item.key, item.value]));
    const types = Object.fromEntries(properties.map(item => [item.key, item.type]));
    const saved = await this.repository.saveMetadata(accountId, id, expectedUpdatedAt, { aliases, tags, properties: values, types });
    return { id: saved.id, aliases: saved.aliases, tags: saved.tags, properties: saved.properties, updatedAt: saved.updatedAt };
  }
}
