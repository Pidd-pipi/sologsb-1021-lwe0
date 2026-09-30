export default defineNuxtConfig({
  compatibilityDate: '2025-09-25',
  ssr: true,
  devtools: { enabled: false },
  modules: ['@pinia/nuxt'],
  css: ['tdesign-vue-next/es/style/index.css', '~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '濒危语言词典编辑与审校工具',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#193c35' },
        { name: 'description', content: '本地优先的濒危语言词典编辑、审校与版本管理工具' }
      ]
    }
  },
  nitro: {
    preset: 'static'
  },
  typescript: {
    strict: true
  }
})
