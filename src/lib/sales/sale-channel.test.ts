import { test } from "node:test";
import assert from "node:assert/strict";
import { guessChannel, netReceived, normalizeSale } from "./sale-channel";

test("net is price less fees, and missing fees count as nothing", () => {
  assert.equal(netReceived(1000, 131.5), 868.5);
  assert.equal(netReceived(1000, null), 1000);
  assert.equal(netReceived(null, 50), null);
});

test("eBay is stored under one buyer spelling and needs fees", () => {
  const sale = normalizeSale({ saleChannel: "EBAY", soldTo: "ebay order 13-1", soldPrice: 500, saleFees: 60 });
  assert.deepEqual(sale, { saleChannel: "EBAY", soldTo: "eBay", saleFees: 60 });
  assert.throws(() => normalizeSale({ saleChannel: "EBAY", soldPrice: 500 }), /fees are required/);
});

test("customer and other need a buyer; fees are optional", () => {
  assert.throws(() => normalizeSale({ saleChannel: "CUSTOMER", soldTo: "  ", soldPrice: 10 }), /Sold to/);
  assert.deepEqual(
    normalizeSale({ saleChannel: "OTHER", soldTo: " Reseller ", soldPrice: 10 }),
    { saleChannel: "OTHER", soldTo: "Reseller", saleFees: null },
  );
});

test("fees may be zero but not negative or above the price", () => {
  assert.equal(normalizeSale({ saleChannel: "EBAY", soldPrice: 100, saleFees: 0 }).saleFees, 0);
  assert.throws(() => normalizeSale({ saleChannel: "OTHER", soldTo: "x", soldPrice: 100, saleFees: -1 }), /zero or more/);
  assert.throws(() => normalizeSale({ saleChannel: "OTHER", soldTo: "x", soldPrice: 100, saleFees: 101 }), /exceed/);
  assert.throws(() => normalizeSale({ saleChannel: "OTHER", soldTo: "x", soldPrice: -5 }), /Sale price/);
});

test("unknown channel is refused; no channel keeps the old behaviour", () => {
  assert.throws(() => normalizeSale({ saleChannel: "BARTER" as never, soldTo: "x", soldPrice: 1 }), /Unknown/);
  assert.equal(normalizeSale({ soldTo: "Acme", soldPrice: 1 }).saleChannel, null);
});

test("a form's starting channel comes from the stored one, else the buyer text", () => {
  assert.equal(guessChannel("CUSTOMER", "eBay"), "CUSTOMER");
  assert.equal(guessChannel(null, "Sold on Ebay."), "EBAY");
  assert.equal(guessChannel(null, "AMGI"), "OTHER");
  assert.equal(guessChannel(null, null), "CUSTOMER");
});
