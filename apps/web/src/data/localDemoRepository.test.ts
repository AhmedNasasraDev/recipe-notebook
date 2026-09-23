import { describe, expect, it } from 'vitest';
import { createLocalDemoRepository, firstRunPrefs } from './localDemoRepository.js';
import { WriteNotAllowedError } from './repository.js';

describe('the local demo repository refuses to fake a write', () => {
  const repo = createLocalDemoRepository();

  it('declares that it cannot write', () => {
    expect(repo.capabilities().canWrite).toBe(false);
    expect(repo.capabilities().source).toBe('local-demo');
  });

  it('rejects saveRecipe with an explanation instead of pretending', () => {
    // This is the shape of bug B8 was: a message claiming a file was written.
    return expect(repo.saveRecipe({ id: 'x' })).rejects.toBeInstanceOf(
      WriteNotAllowedError,
    );
  });

  it('serves the five demo recipes', async () => {
    const list = await repo.listRecipes();
    expect(list).toHaveLength(5);
    expect(await repo.getRecipe('brioche')).not.toBeNull();
    expect(await repo.getRecipe('nope')).toBeNull();
  });

  it('starts a first-time visitor before onboarding, not after', () => {
    expect(firstRunPrefs().done).toBe(false);
    expect(firstRunPrefs().profile).toBe('pro');
  });
});

describe('recipesUsing, in the read-only demo notebook', () => {
  it('names the recipe that really does depend on the ganache', async () => {
    // The demo set contains one genuine sub-recipe link. Reporting "nothing
    // depends on this" about it was the wrong answer to the question stage 6
    // makes the delete dialog ask.
    const repo = createLocalDemoRepository();
    const users = await repo.recipesUsing('ganache');
    expect(users.map((r) => r.id)).toEqual(['brioche-choc']);
  });

  it('reports nothing for a recipe nothing uses', async () => {
    const repo = createLocalDemoRepository();
    expect(await repo.recipesUsing('brioche')).toEqual([]);
  });

  it('never reports a recipe as depending on itself', async () => {
    const repo = createLocalDemoRepository();
    const users = await repo.recipesUsing('brioche-choc');
    expect(users.map((r) => r.id)).not.toContain('brioche-choc');
  });
});
