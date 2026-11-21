/* Carnet · 云端商品只读接口。商品发布 / 修改由云端管理面完成，客户端无写权限。 */
(function () {
  'use strict';
  if (!window.WorkBuddyCloud) return;
  const cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: 'https://carnet-store.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_40yH2WOhelnV7suMdfeKra_EI8K6Noj9SRjLyGUDHSOAnHfhEU2jGxw'
  });
  /* 后期上传素材时，云端可以只存文件地址；这里按类型把 .lbl / JSON 文件取回再交给商店归一化。 */
  async function linkedPayload(base, key, url) {
    if (!url || base[key]) return base;
    try {
      const res = await fetch(new URL(String(url), document.baseURI).href, { cache: 'no-cache' });
      if (!res.ok) throw new Error('asset-http-' + res.status);
      const data = await res.json();
      const value = key === 'pack'
        ? (data.pack || (data.app === 'carnet-stickers' ? data : null))
        : data[key];
      return value ? { ...base, [key]: value } : base;
    } catch (e) {
      console.warn('[store] 云端素材文件读取失败：' + url, e);
      return base;
    }
  }
  window.CarnetStoreCloud = {
    async loadProducts() {
      const { data, error } = await cloud.database
        .from('store_products')
        .select('id,type,name,code,description,payload,sort_order')
        .eq('status', 'published')
        .order('sort_order', { ascending: true })
        .limit(200);
      if (error) throw error;
      return Promise.all((data || []).map(async row => {
        const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
        let p = {
          id: String(row.id), type: row.type,
          code: String(row.code || 'CARNET'),
          description: String(row.description || ''),
          ...payload
        };
        if (p.type === 'journal' && !p.journal && p.journalUrl)
          p = await linkedPayload(p, 'journal', p.journalUrl);
        if (p.type === 'stickers' && !p.pack && p.packUrl)
          p = await linkedPayload(p, 'pack', p.packUrl);
        if (p.type === 'font' && !p.font && p.fontUrl)
          p = await linkedPayload(p, 'font', p.fontUrl);
        return p;
      }));
    }
  };
})();
