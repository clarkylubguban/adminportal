export function findNativeOrderBySourceInquiryId(nativeRows, inquiryId) {
  const target = cleanKey(inquiryId);
  if (!target) return null;
  return (Array.isArray(nativeRows) ? nativeRows : []).find((row) => {
    return cleanKey(row?.source_inquiry_id || row?.sourceInquiryId) === target;
  }) || null;
}

export function hasNativeOrderAuthority(nativeRows, inquiryId) {
  return Boolean(findNativeOrderBySourceInquiryId(nativeRows, inquiryId));
}

function cleanKey(value) {
  return String(value || "").trim().toLowerCase();
}
