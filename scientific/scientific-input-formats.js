import path from 'node:path';

export function getOpaqueInputMetadata(fileName) {
  const format = path.extname(fileName).slice(1).toLowerCase();
  if (['rds', 'rda', 'rdata'].includes(format)) return { parsedAs: 'opaque-r-data', original_format: format, data_format: true,
    required_reader: 'Restricted R readRDS() or load(), when required by the requested analysis', reader_status: 'deferred_to_scientific_execution',
    scope: 'Original bytes retained. No Node deserialization or inferred object contents.' };
  const readers = { sav: 'SPSS reader such as haven::read_sav', zsav: 'Compressed SPSS reader such as haven::read_sav',
    dta: 'Stata reader such as haven::read_dta', sas7bdat: 'SAS reader such as haven::read_sas', xpt: 'SAS transport reader such as haven::read_xpt',
    zip: 'Bounded archive extraction with explicit member selection', doc: 'Legacy Word binary document reader' };
  if (!readers[format]) return null;
  return { parsedAs: 'opaque-unsupported-format', original_format: format, data_format: !['zip', 'doc'].includes(format),
    required_reader: readers[format], reader_status: 'not_provisioned_by_this_harness', supported_reader: false,
    scope: 'Original bytes retained; a suitable reader is required. The file was not parsed or decoded as UTF-8 data.' };
}
