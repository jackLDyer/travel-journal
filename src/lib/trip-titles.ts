export function appendTripYears(title: string, dates: string[]) {
  const years = [
    ...new Set(dates.map((date) => date.slice(0, 4)).filter((year) => /^\d{4}$/.test(year))),
  ].sort();

  return years.length > 0 ? `${title} ${years.join("/")}` : title;
}
