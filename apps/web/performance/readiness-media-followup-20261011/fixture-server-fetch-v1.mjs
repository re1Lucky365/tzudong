// Inject only into the owned loopback test process, never a deployment.
// Authentication is synthetic; this does not prove real session admission.
const originalFetch = globalThis.fetch;
const host = 'aqlcofblfxdrjhhdmarw.supabase.co';
const owner = '11111111-1111-4111-8111-111111111111';
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).hostname !== host) return originalFetch(input, init);
  const path = new URL(request.url).pathname;
  if (request.headers.get('authorization') !== `Bearer ${process.env.TZUDONG_FIXTURE_JWT}`) {
    return Response.json({code:'FIXTURE_UNAUTHORIZED'}, {status:401});
  }
  if(path==='/auth/v1/user')return Response.json({id:owner,aud:'authenticated',role:'authenticated',email:'recovery@fixture.invalid',app_metadata:{provider:'email'},user_metadata:{nickname:'Fixture'}});
  if(path==='/rest/v1/rpc/get_current_privacy_eligibility')return Response.json({schemaVersion:1,eligible:true,reasonCode:'PRIVACY_ELIGIBLE',policyVersionId:owner,policyVersion:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'});
  if(path==='/rest/v1/rpc/is_current_auth_session_active')return Response.json(true);
  return Response.json({code:'FIXTURE_ROUTE_NOT_ADMITTED'}, {status:503});
};
