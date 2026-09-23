import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTION_RANK,
  PERM_DEFAULT,
  ROLE_RANK,
  assignableRoles,
  can,
  canActOnMember,
} from './roles.js';
import type { GroupRole } from '../../lib/database.types.js';

/*
  These tests read the MIGRATIONS, not a second copy of the numbers.

  A test that restated `owner: 4` would pass forever while the database moved
  underneath it — and this file's whole job is to be the same model as the
  database's. So the ranks are parsed out of 0030's `role_rank`, and every
  action's threshold is checked against the policy that enforces it.
*/
const MIGRATIONS = join(import.meta.dirname, '../../../../../supabase/migrations');
const sql0030 = readFileSync(join(MIGRATIONS, '0030_roles_and_invitation_lifecycle.sql'), 'utf8');
const sql0032 = readFileSync(join(MIGRATIONS, '0032_group_chat.sql'), 'utf8');

describe('the ranks are the ranks in migration 0030', () => {
  it('matches role_rank() case for case', () => {
    const body = sql0030.slice(sql0030.indexOf('function public.role_rank'));
    const fromSql: Record<string, number> = {};
    for (const m of body.matchAll(/when '(\w+)' then (\d+)/g)) {
      fromSql[m[1] as string] = Number(m[2]);
    }
    expect(fromSql).toEqual({ owner: 4, admin: 3, instructor: 2, member: 1 });
    expect(ROLE_RANK).toEqual(fromSql);
  });

  it('knows the four roles the CHECK constraint allows, and no others', () => {
    const check = sql0030.match(/check \(role in \(([^)]*)\)\)/);
    const allowed = [...(check?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual(Object.keys(ROLE_RANK).sort());
  });
});

describe("each action's threshold is the policy's threshold", () => {
  /** The rank a named policy compares against, read out of the migration. */
  const policyRank = (sql: string, policy: string): number => {
    const at = sql.indexOf(`create policy ${policy}`);
    expect(at, `policy ${policy} not found`).toBeGreaterThan(-1);
    const stmt = sql.slice(at, sql.indexOf(';', at));
    const m = stmt.match(/group_rank\([^)]*\) >= (\d)/);
    return Number(m?.[1] ?? -1);
  };

  it('manage and roles are rank 3, as groups_write and members_role are', () => {
    expect(policyRank(sql0030, 'groups_write')).toBe(3);
    expect(ACTION_RANK.manage).toBe(3);
    expect(policyRank(sql0030, 'members_role')).toBe(3);
    expect(ACTION_RANK.roles).toBe(3);
  });

  it('destroy is rank 4 exactly — groups_delete compares with =, not >=', () => {
    const at = sql0030.indexOf('create policy groups_delete');
    expect(sql0030.slice(at, sql0030.indexOf(';', at))).toMatch(/group_rank\(id\) = 4/);
    expect(ACTION_RANK.destroy).toBe(4);
  });

  it('announce and moderate are rank 2, as the chat policies are', () => {
    // messages_insert's announcement branch, and messages_update's staff branch
    expect(sql0032).toMatch(/kind = 'announcement'[\s\S]{0,80}group_rank\(group_id\) >= 2/);
    expect(ACTION_RANK.announce).toBe(2);
    expect(policyRank(sql0032, 'messages_update')).toBe(2);
    expect(ACTION_RANK.moderate).toBe(2);
  });

  it('participate is rank 1 — a member may post and read', () => {
    expect(policyRank(sql0032, 'messages_read')).toBe(1);
    expect(ACTION_RANK.participate).toBe(1);
  });
});

describe('can()', () => {
  it('lets a member participate and nothing more', () => {
    expect(can('member', 'participate')).toBe(true);
    for (const a of ['teach', 'invite', 'perms', 'manage', 'roles', 'destroy'] as const) {
      expect(can('member', a)).toBe(false);
    }
  });

  it('lets an instructor teach, invite and set permissions, but not manage', () => {
    expect(can('instructor', 'teach')).toBe(true);
    expect(can('instructor', 'invite')).toBe(true);
    expect(can('instructor', 'perms')).toBe(true);
    expect(can('instructor', 'manage')).toBe(false);
    expect(can('instructor', 'roles')).toBe(false);
  });

  it('lets an admin manage and hand out roles, but never delete the group', () => {
    expect(can('admin', 'manage')).toBe(true);
    expect(can('admin', 'roles')).toBe(true);
    expect(can('admin', 'destroy')).toBe(false);
    expect(can('owner', 'destroy')).toBe(true);
  });
});

describe('assignableRoles — strictly below the assigner', () => {
  it('an owner may hand out admin, instructor and member, never owner', () => {
    expect(assignableRoles('owner')).toEqual(['admin', 'instructor', 'member']);
  });

  it('an admin may not create another admin — equal rank is not below', () => {
    expect(assignableRoles('admin')).toEqual(['instructor', 'member']);
  });

  it('an instructor may hand out nothing at all', () => {
    // `can(instructor, 'roles')` is already false, so the picker never shows;
    // this is the second line of defence in case it ever does.
    expect(assignableRoles('instructor')).toEqual(['member']);
    expect(can('instructor', 'roles')).toBe(false);
  });
});

describe('canActOnMember — who may demote or remove whom', () => {
  const cases: Array<[GroupRole, GroupRole, boolean]> = [
    ['owner', 'admin', true],
    ['owner', 'member', true],
    ['admin', 'instructor', true],
    ['admin', 'admin', false],
    ['admin', 'owner', false],
    ['instructor', 'member', false],
    ['member', 'member', false],
  ];

  for (const [mine, theirs, expected] of cases) {
    it(`${mine} → ${theirs} is ${expected}`, () => {
      expect(canActOnMember(mine, theirs)).toBe(expected);
    });
  }
});

describe('§10.4 default permissions', () => {
  it('is view-only, and the database agrees', () => {
    expect(PERM_DEFAULT).toEqual({
      view: true,
      save: false,
      print: false,
      download: false,
      shareOut: false,
    });
    // 0023 created the columns with these defaults; a default that disagreed
    // would hand out a recipe the instructor never released.
    const sql0023 = readFileSync(
      join(MIGRATIONS, '0023_groups_courses_lessons.sql'),
      'utf8',
    );
    expect(sql0023).toMatch(/perm_view\s+boolean not null default true/);
    for (const col of ['perm_save', 'perm_print', 'perm_download', 'perm_share_out']) {
      expect(sql0023).toMatch(new RegExp(`${col}\\s+boolean not null default false`));
    }
  });
});
