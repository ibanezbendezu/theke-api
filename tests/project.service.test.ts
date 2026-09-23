import { describe, expect, it } from 'vitest';
import { normalizeProjectName } from '../src/modules/projects/project.service.js';

describe('project name', () => {
  it('normaliza un nombre válido', () => expect(normalizeProjectName('  Investigación  ')).toBe('Investigación'));
  it.each(['', '   ', 'x'.repeat(121)])('rechaza nombres inválidos', value => {
    expect(() => normalizeProjectName(value)).toThrow();
  });
});
