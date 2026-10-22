import { createRecordMutationsHoldReadbackResponse } from './readback-response';

export const runtime = 'nodejs';

export async function GET() {
  return createRecordMutationsHoldReadbackResponse();
}
