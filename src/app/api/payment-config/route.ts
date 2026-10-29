import { NextResponse } from 'next/server'
import { config } from '@/lib/config'

export async function GET() {
  return NextResponse.json({
    trc20: {
      walletAddress: config.tronWalletAddress,
      network: 'TRC20',
      token: 'USDT',
    },
    binance: {
      payId: config.binancePayId,
      label: 'Binance Pay',
      network: 'Binance',
      token: 'USDT',
    },
  })
}
