import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compare, inventory } from './check-types-coverage.mjs';

const types = (tables, fns) => `export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
${tables.map(([name, cols]) => `      ${name}: {
        Row: {
${cols.map((c) => `          ${c}: string`).join('\n')}
        }
        Insert: {
          ignored_insert_only?: string
        }
      }`).join('\n')}
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
${fns.map((f) => `      ${f}: { Args: never; Returns: string }`).join('\n')}
    }
  }
}
export const Constants = { public: { Enums: { ignored: [] } } }
`;

test('inventory reads schemas, tables, row columns and functions only', () => {
  const names = inventory(types([['games', ['id', 'slug']]], ['get_my_game_progress']));
  assert.deepEqual([...names].sort(), [
    'public.Functions.get_my_game_progress', 'public.Tables.games', 'public.Tables.games.id', 'public.Tables.games.slug',
  ]);
});

test('names the committed file has but the bootstrap lacks are missing; the reverse is only stale', () => {
  const committed = inventory(types([['games', ['id', 'slug']]], ['get_my_game_progress']));
  const generated = inventory(types([['games', ['id']], ['inha_mail_badges', ['email']]], ['my_inha_mail_badge']));
  const { missing, untyped } = compare(committed, generated);
  assert.deepEqual(missing, ['public.Functions.get_my_game_progress', 'public.Tables.games.slug']);
  assert.deepEqual(untyped, ['public.Functions.my_inha_mail_badge', 'public.Tables.inha_mail_badges',
    'public.Tables.inha_mail_badges.email']);
});

test('the committed database.types.ts parses', () => {
  const names = inventory(readFileSync(new URL('../../supabase/database.types.ts', import.meta.url), 'utf8'));
  assert.ok(names.has('public.Tables.user_game_progress.progress'));
  assert.ok(names.has('public.Functions.save_my_game_progress'));
  assert.ok(names.size > 100);
});
