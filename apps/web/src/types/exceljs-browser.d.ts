declare module 'exceljs/lib/exceljs.bare.js' {
  import type * as ExcelJS from 'exceljs';

  const exceljsBrowser: typeof ExcelJS;
  export default exceljsBrowser;
}
