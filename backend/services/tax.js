'use strict';

/** Convert a decimal currency amount to integer paise without float accumulation. */
function toPaise(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('Amount must be a finite non-negative number');
  const paise = Math.round(value * 100);
  if (!Number.isSafeInteger(paise)) throw new Error('Amount exceeds the supported monetary range');
  return paise;
}

/** Calculate GST in integer paise. rate is a percentage (for example, 5). */
function calculateGst(taxablePaise, rate, intraState) {
  if (!Number.isSafeInteger(taxablePaise) || taxablePaise < 0) throw new Error('Taxable value must be non-negative integer paise');
  const gstRate = Number(rate);
  const basisPoints = Math.round(gstRate * 100);
  if (!Number.isFinite(gstRate) || gstRate < 0 || basisPoints > 10000) throw new Error('GST rate must be between 0 and 100 percent');
  const totalTax = Number((BigInt(taxablePaise) * BigInt(basisPoints) + 5000n) / 10000n);
  if (!Number.isSafeInteger(totalTax)) throw new Error('Tax exceeds the supported monetary range');
  if (intraState) {
    const cgst = Math.floor(totalTax / 2);
    return { cgstPaise: cgst, sgstPaise: totalTax - cgst, igstPaise: 0, totalTaxPaise: totalTax };
  }
  return { cgstPaise: 0, sgstPaise: 0, igstPaise: totalTax, totalTaxPaise: totalTax };
}

module.exports = { toPaise, calculateGst };
