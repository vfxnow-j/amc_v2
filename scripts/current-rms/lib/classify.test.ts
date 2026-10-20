import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLine, cpuModel, cpuModels, bestAssetMatches } from './classify'

const c = (name: string, poSubject = '', serialisedProduct = false) => classifyLine({ name, poSubject, serialisedProduct })

test('build components get a core kind', () => {
  assert.deepEqual([c('AMD Ryzen Threadripper 3960X').group, c('AMD Ryzen Threadripper 3960X').kind], ['core_component', 'cpu'])
  assert.equal(c('Ryzen Threadripper 3960X 24C/48T 280W').kind, 'cpu')
  assert.equal(c('SMP3975WX-32C280W(x1)SEEDING').kind, 'cpu')
  assert.equal(c('MSI TRX40 Pro Motherboard').kind, 'board')
  assert.equal(c('ASR Ryzen sTRX4 ATX 4xPCE16 3xM.2 10GbE W').kind, 'board')
  assert.equal(c('MBD-M12SWA-TF-O(x1)Workstation FlagshipMB,E-ATX').kind, 'board')
  assert.equal(c('Crucial 16GB DDR4 ram modules').kind, 'ram')
  assert.equal(c('Fractal Define 7 Case').kind, 'case')
  assert.equal(c('FRA FT XL R2 BK 4/0/(8) 4x5.25 9xPCE 3xFans').kind, 'case')
  assert.equal(c('CSE-GS7A-2000B(x1)[NR]GS7 Tower Chassis (Black) with 2000W PWS').kind, 'case')
  assert.equal(c('EVGA Power Supply 850W').kind, 'psu')
  assert.equal(c('Noctua NH-U12S SE-AM4, Premium CPU Cooler for').kind, 'cooler')
  assert.equal(c('Crucial SSD 1TB NVMe M.2 Drives').kind, 'storage')
})

test('whole units, tracked parts, extras, non-assets', () => {
  assert.equal(c('LENOVO : ThinkStation P620, AMD Threadripper Pro 3975WX (3.50GHz, 16MB)').group, 'whole_unit')
  assert.equal(c('Mac Studio M3 ULTRA 28core CPU 60ore GPU/96GB').group, 'whole_unit')
  assert.equal(c('GPU/Threadripper Workstation').group, 'whole_unit')
  assert.equal(c('anything', '', true).group, 'whole_unit')
  assert.equal(c('Blackmagic Design DeckLink 4K Extreme 12G').group, 'tracked_part')
  assert.equal(c('NONREFUNDABLE SHIPPING FEE').group, 'extra')
  assert.equal(c('MC0037(x1)ASSEMBLY FEE').group, 'extra')
  assert.equal(c('8473.30.0002 / EAR99').group, 'non_asset')
  assert.equal(c('WINDOWS SERVER 2022 STANDARD - 16 CORE PACK').group, 'non_asset')
  assert.equal(c('Universal Rack Rails 3U kit').group, 'non_asset')
  assert.equal(c('Crucial RAM 32GB DDR4', "Stargate's PC components for sale").group, 'non_asset')
  assert.equal(c('CBL-PWCD-0925(x1)PWCD,US,NEMA 5-15P TO IEC60320 C19, 6FT').group, 'non_asset')
  assert.equal(c('SNK-P0064AP4(x1)4U Active CPU Heat Sink for AMD Socket SP3 Platform').kind, 'cooler')
})

test('real unclassified lines from the first derive run', () => {
  assert.equal(c('PowerEdge C6520').group, 'whole_unit')
  assert.equal(c('Lenovo ThingPad P16').group, 'whole_unit')
  assert.equal(c('Custom AMD build').group, 'whole_unit')
  assert.equal(c('APC Smart-UPS SRT 3000VA 230V').group, 'whole_unit')
  assert.equal(c('Synology RX1217RP 12-Bay Storage Expansion Unit').group, 'whole_unit')
  assert.equal(c('FortiGate-201F Hardware plus 24x7 FortiCare and FortiGuard').group, 'whole_unit')
  assert.equal(c('Fortinet Coterm Renewal').group, 'non_asset')
  assert.equal(c('VCG409024TFXPB1 - RTX4090/24GB/TRPLFAN').group, 'tracked_part')
  assert.equal(c('3060TI').group, 'tracked_part')
  assert.equal(c('Intel Ethernet Converged Network Adapter X540-T2').group, 'tracked_part')
  assert.equal(c('KNG 64G D5 56 CL46 E R').kind, 'ram')
  assert.equal(c('HPT2-1200M-G5T').kind, 'psu')
  assert.equal(c('SLIGER CX3173a').kind, 'case')
  assert.equal(c('ASUS Pro WS WRX80E-SAGE SE').kind, 'board')
  assert.equal(c('ST16000NM001G').kind, 'storage')
  assert.equal(c('6548Y+ 2P 32C2.5G250W(24/2.6/225,16/3/205)60M SGX128 DIQD 7y').kind, 'cpu')
  assert.equal(c('Logitech MK120 Wired USB Keyboard and Mouse').group, 'non_asset')
  assert.equal(c('AppleCare+ for Mac mini M4 Auto Enroll (2024)').group, 'non_asset')
  assert.equal(c('Assembly and Test').group, 'extra')
})

test('cpu model tokens', () => {
  assert.equal(cpuModel('AMD Ryzen Threadripper 3960X'), '3960X')
  assert.equal(cpuModel('SMP3975WX-32C280W(x1)SEEDING'), '3975WX')
  assert.equal(cpuModel('Xeon Gold 5220R'), '5220R')
  assert.equal(cpuModel('Intel Core Ultra 9 285K'), '285K')
  assert.equal(cpuModel('i9-14900KF'), '14900KF')
  assert.equal(cpuModel('AMD Ryzen 9 9950X3D 16-Core'), '9950X3D')
  assert.equal(cpuModel('Crucial 16GB DDR4'), null)
  assert.deepEqual(cpuModels('NZXT H2 9800X3D / 2TB NVMe SSD / 32GB DDR5 RAM / RTX 5080'), ['9800X3D', '5080'])
})

test('name matching needs a shared model token and picks the best asset', () => {
  const assets = ['Lenovo ThinkStation P620 3975WX 32C', 'Lenovo ThinkStation P620 5975WX 32C', 'Mac Studio M1 ULTRA 4TB']
  assert.deepEqual(bestAssetMatches('LENOVO : ThinkStation P620, AMD Threadripper Pro 3975WX', assets), ['Lenovo ThinkStation P620 3975WX 32C'])
  assert.deepEqual(bestAssetMatches('Mac Studio M3 ULTRA 28core CPU 60ore GPU/96GB', assets), [])
  const gpus = ['RTX A5000 24G', 'RTX A4000 16G', 'GeForce RTX 3060 Ti', 'RTX 4090 24GB', 'GeForce RTX 3080', 'GeForce RTX 3080 Trinity OC', 'C6520 Quad Server']
  assert.deepEqual(bestAssetMatches('NVIDIA RTX A5000', gpus), ['RTX A5000 24G'])
  assert.deepEqual(bestAssetMatches('3060TI', gpus), ['GeForce RTX 3060 Ti'])
  assert.deepEqual(bestAssetMatches('VCG409024TFXPB1 - RTX4090/24GB/TRPLFAN', gpus), ['RTX 4090 24GB'])
  assert.deepEqual(bestAssetMatches('PowerEdge C6520', gpus), ['C6520 Quad Server'])
  assert.equal(bestAssetMatches('ASUS TUF Gaming NVIDIA GeForce RTX 3080', gpus).length, 2) // ambiguous → orange
  assert.deepEqual(bestAssetMatches('Crucial 16GB DDR4', gpus), [])
})
