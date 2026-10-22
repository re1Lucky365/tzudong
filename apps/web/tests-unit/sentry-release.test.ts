import { execFileSync } from 'node:child_process';
import { expect, test } from 'bun:test';
import { sentryBuildRelease } from '../lib/monitoring/sentry-release';
import { sanitizeSentryEvent } from '../lib/monitoring/sentry-privacy';

test('binds a full source commit through the event privacy boundary', () => {
  const sha='b01012345678'+'b'.repeat(28);
  expect(sentryBuildRelease(sha)).toBe(sha);
  const event=sanitizeSentryEvent({type:undefined,release:sentryBuildRelease(sha),user:{email:'synthetic-private@example.test'},exception:{values:[{type:'TypeError',value:'synthetic-private@example.test'}]}});
  expect(event?.release).toBe(sha);
  expect(event?.user).toBeUndefined();
});
test('does not substitute package versions, account identifiers, abbreviated commits, or secret values', () => {
  for(const value of [undefined,'','1.2.4','tinyburn-data-lab','18400459','b'.repeat(41),'B'.repeat(40),' '+ 'b'.repeat(40), 'synthetic-private@example.test'])expect(sentryBuildRelease(value)).toBeUndefined();
});

test('actual composed Next config keeps a valid build identity and drops a package label', () => {
  for(const input of ['b'.repeat(40),'1.2.4']){
    const output=execFileSync(process.execPath,['--eval',`const {default:config}=await import('./next.config.mjs'); console.log(JSON.stringify({release:config.env.NEXT_PUBLIC_SENTRY_RELEASE}));`],{cwd:process.cwd(),env:{...process.env,VERCEL_GIT_COMMIT_SHA:input},encoding:'utf8'});
    expect(JSON.parse(output.trim()).release).toBe(input.length===40?input:'');
  }
});
