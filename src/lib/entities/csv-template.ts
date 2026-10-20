/** The import file's header and a worked example, in the exact form parseItemCsv accepts. */
export const CSV_HEADER = 'name,manufacturer,model,category,tracking,serial,owner_tag,quantity,location'
export const CSV_TEMPLATE = [
  CSV_HEADER,
  'Rack server,Dell,R740,Servers,serialized,SN-0001,OWN-1,,Warehouse A',
  'Cat6 cable,,,Cabling,quantity,,,40,Warehouse A',
  '',
].join('\n')
