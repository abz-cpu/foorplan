/**
 * RdSAP survey capture — the structured, non-geometric inputs a Domestic
 * Energy Assessor records on site alongside the measured plan (wall/roof/
 * floor construction, glazing, heating, hot water, ventilation, lighting).
 *
 * Modelled schema-first: one SURVEY_SCHEMA drives the capture panel, the CSV
 * export, and validation, so a new field is added in exactly one place. The
 * option wordings follow RdSAP conventions but this is a data-capture aid,
 * not a SAP calculation engine.
 */

export interface SurveyFieldDef {
  key: string;
  label: string;
  /** select options; omit for a free-text or numeric field */
  options?: readonly string[];
  kind?: 'select' | 'number' | 'text';
  suffix?: string;
}

export interface SurveyGroupDef {
  title: string;
  fields: readonly SurveyFieldDef[];
}

/** Free-form key→value bag; keys are SurveyFieldDef.key values. */
export type PropertySurvey = Record<string, string | number | undefined>;

export const RDSAP_AGE_BANDS = [
  'Before 1900',
  '1900–1929',
  '1930–1949',
  '1950–1966',
  '1967–1975',
  '1976–1982',
  '1983–1990',
  '1991–1995',
  '1996–2002',
  '2003–2006',
  '2007–2011',
  '2012 onwards',
] as const;

export const SURVEY_SCHEMA: readonly SurveyGroupDef[] = [
  {
    title: 'Property',
    fields: [
      {
        key: 'propertyType',
        label: 'Property type',
        options: [
          'Detached house',
          'Semi-detached house',
          'Mid-terrace house',
          'End-terrace house',
          'Detached bungalow',
          'Semi-detached bungalow',
          'Flat',
          'Maisonette',
        ],
      },
      { key: 'ageBand', label: 'Age band', options: RDSAP_AGE_BANDS },
      { key: 'extensions', label: 'Extensions', options: ['0', '1', '2', '3', '4+'] },
    ],
  },
  {
    title: 'Walls',
    fields: [
      {
        key: 'wallConstruction',
        label: 'Construction',
        options: ['Cavity', 'Solid brick', 'Timber frame', 'System build', 'Stone', 'Cob', 'Unknown'],
      },
      {
        key: 'wallInsulation',
        label: 'Insulation',
        options: ['As built (none)', 'Internal', 'External', 'Filled cavity', 'Unknown'],
      },
    ],
  },
  {
    title: 'Roof',
    fields: [
      {
        key: 'roofType',
        label: 'Type',
        options: ['Pitched (loft)', 'Pitched (room-in-roof)', 'Flat', 'Another dwelling above'],
      },
      {
        key: 'roofInsulation',
        label: 'Insulation',
        options: ['None', '50mm', '100mm', '150mm', '200mm', '250mm', '270mm', '300mm+', 'Unknown'],
      },
    ],
  },
  {
    title: 'Floor',
    fields: [
      {
        key: 'floorType',
        label: 'Type',
        options: ['Solid', 'Suspended timber', 'Another dwelling below', 'Unknown'],
      },
      { key: 'floorInsulation', label: 'Insulation', options: ['None', 'Insulated', 'Unknown'] },
    ],
  },
  {
    title: 'Windows',
    fields: [
      {
        key: 'glazingType',
        label: 'Glazing',
        options: ['Single', 'Double', 'Triple', 'Secondary', 'Mixed'],
      },
      {
        key: 'glazingExtent',
        label: 'Extent',
        options: ['Less than half', 'About half', 'More than half', 'Full/typical'],
      },
    ],
  },
  {
    title: 'Main heating',
    fields: [
      {
        key: 'mainHeatingFuel',
        label: 'Fuel',
        options: [
          'Mains gas',
          'Electricity',
          'Oil',
          'LPG',
          'Solid fuel',
          'Heat network',
          'Air source heat pump',
          'Ground source heat pump',
          'Biomass',
        ],
      },
      {
        key: 'mainHeatingSystem',
        label: 'System',
        options: [
          'Boiler (combi)',
          'Boiler (regular)',
          'Back boiler',
          'Storage heaters',
          'Warm air',
          'Heat pump',
          'Room heaters',
          'Community',
        ],
      },
      {
        key: 'heatingControls',
        label: 'Controls',
        options: [
          'None',
          'Programmer only',
          'Room thermostat',
          'Programmer + room stat',
          'Programmer + room stat + TRVs',
          'Smart',
        ],
      },
    ],
  },
  {
    title: 'Hot water',
    fields: [
      {
        key: 'hotWater',
        label: 'Source',
        options: [
          'From main heating',
          'Dedicated boiler',
          'Immersion (off-peak)',
          'Immersion (on-peak)',
          'Heat pump',
          'Instantaneous',
          'Community',
        ],
      },
      {
        key: 'cylinderInsulation',
        label: 'Cylinder insulation',
        options: ['No cylinder', 'Loose jacket', 'Factory 25mm', 'Factory 38mm', 'Factory 50mm', 'Factory 80mm+', 'Unknown'],
      },
    ],
  },
  {
    title: 'Ventilation & lighting',
    fields: [
      {
        key: 'ventilation',
        label: 'Ventilation',
        options: ['Natural', 'Extract fans', 'Positive input (PIV)', 'MEV', 'MVHR'],
      },
      { key: 'lowEnergyLightingPct', label: 'Low-energy lighting', kind: 'number', suffix: '%' },
    ],
  },
  {
    title: 'Notes',
    fields: [{ key: 'notes', label: 'Assessor notes', kind: 'text' }],
  },
] as const;

/** How many survey fields have a non-empty value — for a panel progress hint. */
export function surveyCompletion(survey: PropertySurvey | undefined): { done: number; total: number } {
  const fields = SURVEY_SCHEMA.flatMap((g) => g.fields);
  const done = fields.filter((f) => {
    const v = survey?.[f.key];
    return v !== undefined && v !== '' && !(typeof v === 'string' && v.trim() === '');
  }).length;
  return { done, total: fields.length };
}
