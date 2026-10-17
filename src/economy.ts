import { ECONOMY, type VehicleSpec } from './data';

export interface IncomeResult {
  paid: number;
  elapsed: number;
}

export function calculatePayout(speedKmh: number, marketPrice: number): number {
  const forwardSpeed = Math.max(0, Number.isFinite(speedKmh) ? speedKmh : 0);
  const price = Math.max(0, Number.isFinite(marketPrice) ? marketPrice : 0);
  if (forwardSpeed < ECONOMY.minimumPayoutSpeed) return 0;
  return Math.floor((forwardSpeed / ECONOMY.speedStepKmh) * (1 + price / ECONOMY.marketMultiplier));
}

export class IncomeClock {
  private elapsed = 0;

  reset(): void { this.elapsed = 0; }

  update(dt: number, speedKmh: number, vehicle: VehicleSpec, enabled: boolean): IncomeResult {
    if (!enabled || speedKmh < ECONOMY.minimumPayoutSpeed) {
      this.reset();
      return { paid: 0, elapsed: 0 };
    }
    const safeDt = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), ECONOMY.maxCreditedElapsedSeconds);
    this.elapsed += safeDt;
    if (this.elapsed < ECONOMY.payoutEverySeconds) return { paid: 0, elapsed: this.elapsed };
    this.elapsed -= ECONOMY.payoutEverySeconds;
    const paid = calculatePayout(speedKmh, vehicle.price);
    return { paid, elapsed: this.elapsed };
  }
}
