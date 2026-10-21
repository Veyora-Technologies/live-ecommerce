type NamedArea = { name?: string | null } | null | undefined;
type LocationRecord = {
  area?: string | null;
  city?: string | null;
  state?: NamedArea;
  lga?: NamedArea;
  cityArea?: NamedArea;
  locality?: NamedArea;
};

/** Build an honest location label from coded geography; never infer from default free text such as "Abuja". */
export function merchantLocationLabel(record: LocationRecord) {
  const names = [record.locality?.name, record.cityArea?.name, record.lga?.name, record.state?.name]
    .filter((name): name is string => Boolean(name?.trim()));
  const unique = [...new Set(names)];
  return unique.length ? unique.join(" · ") : record.area?.trim() || "Location not yet coded";
}
