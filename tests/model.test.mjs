import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../app/lib/model.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { publicConfigValid, countStats } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('client configuration accepts public keys and rejects privileged keys', () => {
  const jwt = role => 'header.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature';
  assert.equal(publicConfigValid('https://example.supabase.co', jwt('anon')), true);
  assert.equal(publicConfigValid('https://example.supabase.co', jwt('service_role')), false);
  assert.equal(publicConfigValid('https://example.supabase.co', 'sb_secret_test'), false);
  assert.equal(publicConfigValid('http://example.supabase.co', 'sb_publishable_test'), false);
});
test('queued provider posts do not inflate published totals', () => {
  assert.deepEqual(countStats([{status:'draft'},{status:'approved'},{status:'scheduled'},{status:'published'}], [{status:'failed'},{status:'needs_review'},{status:'completed'}], [{paused_for_human:true,status:'open'},{paused_for_human:true,status:'resolved'}]), {review:1,scheduled:2,published:1,failures:2,attention:1});
});
