export const useTitle = (page: string, subpage?: string) => {
  useHead({ title: buildPageTitle(page, subpage) })
}
