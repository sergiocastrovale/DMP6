import { z } from 'zod'
import { parseTerms } from '~/helpers/playlistGenerators'

// Shape only - the matching rules (name, keywords per type) stay in helpers/playlistGenerators.validateGenerator.
const generatorFields = {
  name: z.string().nullish().transform(v => v?.trim() ?? ''),
  description: z.string().nullish().transform(v => v?.trim() || null),
  terms: z.union([z.array(z.string()), z.string()]).nullish()
    .transform(v => parseTerms(Array.isArray(v) ? v.join('\n') : (v ?? ''))),
}

export const createGeneratorBodySchema = z.object({
  type: z.enum(['GENRE', 'REGION']),
  ...generatorFields,
})

// Type is fixed at creation, so an update body never carries one.
export const updateGeneratorBodySchema = z.object(generatorFields)
