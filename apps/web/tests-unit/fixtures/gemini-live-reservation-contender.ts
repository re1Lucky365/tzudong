import { existsSync } from 'node:fs';
import { reserveJsonReceipt } from '../../scripts/gemini-live-verification-io';

const [receiptPath, gatePath] = process.argv.slice(2);
if (!receiptPath || !gatePath) throw new Error('reservation_fixture_arguments_required');
while (!existsSync(gatePath)) await Bun.sleep(1);

try {
  const receipt = reserveJsonReceipt(receiptPath, { pending: 'reserved', generationCallsStarted: 0 });
  receipt.close();
  console.log('reserved');
} catch (error) {
  if (error instanceof Error && error.message === 'existing_receipt_requires_readback') {
    console.log('blocked');
    process.exitCode = 2;
  } else {
    throw error;
  }
}
