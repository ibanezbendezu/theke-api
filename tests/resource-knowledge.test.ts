import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { Database } from '../src/infrastructure/database/database.js';
import { accounts, memberships, resourceMentions, resourcePropertyDefinitions, resources, resourceVersions, users } from '../src/infrastructure/database/schema.js';
import { AccountService } from '../src/modules/account/account.service.js';
import { NoteService } from '../src/modules/resources/note.service.js';
import { ResourceKnowledgeRepository } from '../src/modules/resources/resource-knowledge.repository.js';
import { ResourceKnowledgeService } from '../src/modules/resources/resource-knowledge.service.js';
import { parseMentions } from '../src/modules/resources/knowledge-links.js';
import { ResourceRepository } from '../src/modules/resources/resource.repository.js';
import { ResourceService } from '../src/modules/resources/resource.service.js';

describe('enlaces internos', () => {
  it('conserva destino, alias y ubicación sin inventar relaciones', () => {
    expect(parseMentions('Inicio [[Destino#Sección|ver dato]] final')).toEqual([{ rawTarget: 'Destino', displayText: 'ver dato', anchor: 'Sección', startOffset: 7, endOffset: 35 }]);
    expect(() => parseMentions('[[|sin destino]]')).toThrow();
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL))('conocimiento de recursos con PostgreSQL', () => {
  const database = new Database(); const accountService = new AccountService(database); const repository = new ResourceKnowledgeRepository(database); const knowledge = new ResourceKnowledgeService(repository); const notes = new NoteService(database, repository); const resourceService = new ResourceService(new ResourceRepository(database), null as never);
  const clerkId = `knowledge_${crypto.randomUUID()}`; let accountId = ''; let userId = '';
  afterAll(async () => {
    if (accountId) {
      const owned = await database.db.select({ id: resources.id }).from(resources).where(eq(resources.accountId, accountId)); const ids = owned.map(item => item.id);
      if (ids.length) { await database.db.delete(resourceMentions).where(inArray(resourceMentions.sourceResourceId, ids)); await database.db.update(resources).set({ currentVersionId: null }).where(inArray(resources.id, ids)); await database.db.delete(resourceVersions).where(inArray(resourceVersions.resourceId, ids)); await database.db.delete(resources).where(inArray(resources.id, ids)); }
      await database.db.delete(resourcePropertyDefinitions).where(eq(resourcePropertyDefinitions.accountId, accountId));
      await database.db.delete(memberships).where(eq(memberships.userId, userId)); await database.db.delete(accounts).where(eq(accounts.id, accountId)); await database.db.delete(users).where(eq(users.id, userId));
    }
    await database.onModuleDestroy();
  });
  it('valida tipos, resuelve enlaces, muestra ambigüedades y restringe por Cuenta', async () => {
    const owner = await accountService.ensureLocalUser({ clerkUserId: clerkId }); accountId = owner.account.id; userId = owner.user.id;
    const target = await notes.create(accountId, userId, { title: 'Destino', content: 'El dato original.' });
    const saved = await knowledge.updateMetadata(accountId, target.id, { aliases: ['Nombre anterior'], tags: ['#tema/subtema'], properties: [{ key: 'priority', type: 'number', value: 3 }, { key: 'reviewed', type: 'checkbox', value: true }], expectedUpdatedAt: target.updatedAt.toISOString() });
    expect(saved.tags).toEqual(['tema/subtema']); expect(saved.properties).toMatchObject({ priority: 3, reviewed: true });
    expect((await resourceService.list(accountId, { query: 'Nombre anterior' })).data.map(item => item.id)).toContain(target.id);
    expect((await resourceService.list(accountId, { tag: 'tema/subtema' })).data.map(item => item.id)).toContain(target.id);
    expect(await knowledge.definitions(accountId)).toEqual(expect.arrayContaining([{ key: 'priority', type: 'number' }, { key: 'reviewed', type: 'checkbox' }]));
    await expect(knowledge.updateMetadata(accountId, target.id, { aliases: [], tags: [], properties: [{ key: 'priority', type: 'text', value: 'alta' }], expectedUpdatedAt: saved.updatedAt.toISOString() })).rejects.toThrow('tipo number');
    const source = await notes.create(accountId, userId, { title: 'Fuente', content: `[[Nombre anterior|ver destino]] [[resource:${target.id}|estable]] [[Inexistente]]` });
    const first = await knowledge.references(accountId, source.id); expect(first.outgoing.map(item => item.resolution)).toEqual(['linked', 'linked', 'unresolved']); expect(first.outgoing[0]?.targetResourceId).toBe(target.id);
    expect((await knowledge.references(accountId, target.id)).incoming).toHaveLength(2);
    const second = await notes.create(accountId, userId, { title: 'Otro', content: '' });
    await knowledge.updateMetadata(accountId, second.id, { aliases: ['Nombre anterior'], tags: [], properties: [], expectedUpdatedAt: second.updatedAt.toISOString() });
    const edited = await notes.update(accountId, userId, source.id, { title: 'Fuente', content: `[[Nombre anterior|ver destino]] [[resource:${target.id}|estable]] [[Inexistente]] extra` });
    expect(edited.currentVersion.ordinal).toBe(2);
    const preserved = await knowledge.references(accountId, source.id); expect(preserved.outgoing[0]?.targetResourceId).toBe(target.id); expect(preserved.outgoing[1]?.targetResourceId).toBe(target.id);
    const ambiguous = await notes.create(accountId, userId, { title: 'Ambigua', content: '[[Nombre anterior]]' });
    expect((await knowledge.references(accountId, ambiguous.id)).outgoing[0]?.resolution).toBe('ambiguous');
    await expect(knowledge.references(crypto.randomUUID(), source.id)).rejects.toThrow('Recurso no encontrado');
  }, 30_000);
});
