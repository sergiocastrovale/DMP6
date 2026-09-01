export const useTitle = (page: string, subpage?: string) => {
  const title = subpage ? `DMP - ${page} - ${subpage}` : `DMP - ${page}`
  useHead({ title })
}
