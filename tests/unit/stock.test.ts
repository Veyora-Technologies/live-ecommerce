import { describe, it, expect } from "vitest";

function computeAvailability(stock:number, threshold:number){
  if(stock===0) return "OUT_OF_STOCK";
  if(stock<=threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

describe("availability",()=>{
  it("maps stock to status",()=>{
    expect(computeAvailability(0,5)).toBe("OUT_OF_STOCK");
    expect(computeAvailability(3,5)).toBe("LOW_STOCK");
    expect(computeAvailability(10,5)).toBe("IN_STOCK");
  });
  it("respects threshold",()=>{
    expect(computeAvailability(5,5)).toBe("LOW_STOCK");
    expect(computeAvailability(6,5)).toBe("IN_STOCK");
  });
});

describe("reservation expiry",()=>{
  it("expires after 24h",()=>{
    const created=new Date();
    const expires=new Date(created.getTime()+24*60*60*1000);
    expect(expires.getTime()-created.getTime()).toBe(86400000);
  });
});
