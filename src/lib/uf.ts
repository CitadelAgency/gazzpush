// State (UF) from the municipality's IBGE code: the first two digits are the state. Pure (Worker and UI).
const UF_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN',
  '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC',
  '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};
export const ufIbge = (ibge: string): string | null => UF_IBGE[ibge.slice(0, 2)] ?? null;
/** The same table in SQL, for an IBGE code column (`CASE substr(col, 1, 2) WHEN '35' THEN 'SP' …`). */
export const ufSql = (col: string) => `CASE substr(${col}, 1, 2) ${Object.entries(UF_IBGE).map(([k, v]) => `WHEN '${k}' THEN '${v}'`).join(' ')} END`;
