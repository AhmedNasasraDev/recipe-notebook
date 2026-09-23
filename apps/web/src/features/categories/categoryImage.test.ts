import { describe, expect, it } from 'vitest';
import { categoryPhoto } from './categoryImage.js';

describe("the handoff photographs are mapped to the notebook's own categories", () => {
  it('gives the three categories the handoff shipped a photograph for', () => {
    expect(categoryPhoto('בצקים')).not.toBeNull();
    expect(categoryPhoto('קרמים ומילויים')).not.toBeNull();
    expect(categoryPhoto('גנאשים ורטבים')).not.toBeNull();
  });

  it("uses the notebook's category name, not the handoff's", () => {
    // The package calls it "גנאשים וסירופים"; the data calls it "גנאשים ורטבים",
    // and the data wins — renaming a category to match a picture would move
    // every recipe in it.
    expect(categoryPhoto('גנאשים וסירופים')).toBeNull();
  });

  it('returns null for a category with no photograph, rather than a stand-in', () => {
    expect(categoryPhoto('עוגות ועוגיות')).toBeNull();
    expect(categoryPhoto('קטגוריה שלא קיימת')).toBeNull();
    expect(categoryPhoto('')).toBeNull();
    expect(categoryPhoto(null)).toBeNull();
    expect(categoryPhoto(undefined)).toBeNull();
  });

  it('tolerates the whitespace a typed category name arrives with', () => {
    expect(categoryPhoto('  בצקים ')).not.toBeNull();
  });

  it('carries alt text that describes the photograph, not the category', () => {
    expect(categoryPhoto('בצקים')?.alt).toMatch(/בצק/);
    expect(categoryPhoto('קרמים ומילויים')?.alt).toMatch(/קרם/);
  });
});
