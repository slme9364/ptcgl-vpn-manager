import { describe, expect, it } from 'vitest';
import { estimateCost } from './index';

describe('estimateCost', () => {
  it('keeps cost components separate and totals them', () => {
    expect(estimateCost({ vmHourlyUsd: .01, externalIpv4HourlyUsd: .005, diskGbMonthlyUsd: .04, diskGb: 10, egressGbUsd: .1 }, 2, 2, 1))
      .toEqual({ vm: .02, ipv4: .01, disk: .4, network: .1, total: .53 });
  });
});
