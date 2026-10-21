import { describe, it, expect } from "vitest";

const allowed:any={
  PENDING: ["CONFIRMED","REJECTED","CANCELLED","EXPIRED"],
  CONFIRMED: ["READY_FOR_PICKUP","CANCELLED"],
  READY_FOR_PICKUP: ["COLLECTED","CANCELLED"],
};

function canTransition(from:string,to:string){
  return (allowed[from]||[]).includes(to);
}

describe("reservation state machine",()=>{
  it("allows valid transitions",()=>{
    expect(canTransition("PENDING","CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED","READY_FOR_PICKUP")).toBe(true);
    expect(canTransition("READY_FOR_PICKUP","COLLECTED")).toBe(true);
  });
  it("blocks invalid",()=>{
    expect(canTransition("PENDING","COLLECTED")).toBe(false);
    expect(canTransition("COLLECTED","CONFIRMED")).toBe(false);
  });
});
