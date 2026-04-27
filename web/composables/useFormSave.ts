export const useFormSave = (saveFn: () => Promise<void>) => {
  const saving = ref(false)
  const saved = ref(false)
  const error = ref('')

  const save = async () => {
    saving.value = true
    saved.value = false
    error.value = ''
    try {
      await saveFn()
      saved.value = true
      setTimeout(() => { saved.value = false }, 3000)
    }
    catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Save failed'
    }
    finally {
      saving.value = false
    }
  }

  return { saving, saved, error, save }
}
