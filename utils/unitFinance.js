
function unitFinance(unit) {
  if (!unit.is_active) {
    return {
      income: 0,
      payout: 0,
      profit: 0,
      missing: false
    };
  }

  const hasTenancy = Boolean(unit.tenancy_id);
  const managed = hasTenancy && unit.rental_model === 'managed';
  const owned = hasTenancy && unit.rental_model === 'alonspace_owned';
  const isAlonSpaceOwned = unit.ownership_type === 'alonspace';

  const rentEnabled =
    !isAlonSpaceOwned || unit.rent_charge_enabled !== false;

  const managementFeeEnabled =
    !isAlonSpaceOwned || unit.management_fee_charge_enabled !== false;

  const managementFee = managementFeeEnabled
    ? Number(unit.monthly_management_fee || 0)
    : 0;

  const needsRent = managed || owned;

  const missing =
    (needsRent && rentEnabled && unit.monthly_rent == null) ||
    (managed && unit.monthly_owner_payout == null);

  const rent = needsRent && rentEnabled
    ? Number(unit.monthly_rent || 0)
    : 0;

  const grossPayout = managed
    ? Number(unit.monthly_owner_payout || 0)
    : 0;

  const includesFee =
    managed &&
    unit.owner_payout_includes_management_fee === true;

  const deductedFee = includesFee ? managementFee : 0;
  const payout = grossPayout - deductedFee;

  const rentAlreadyIncludesFee =
    isAlonSpaceOwned &&
    unit.rent_includes_management_fee === true &&
    rentEnabled &&
    needsRent;

  const income =
    rent +
    (rentAlreadyIncludesFee ? 0 : managementFee) -
    deductedFee;

  return {
    income,
    payout,
    grossPayout,
    deductedFee,
    includesFee,
    profit: income - payout,
    missing
  };
}

module.exports = { unitFinance };
