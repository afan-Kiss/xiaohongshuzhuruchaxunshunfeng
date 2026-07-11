#!/usr/bin/env node
/** Fetch raw upstream package detail via cookie (not normalized DTO). */
const { fetchPackageDetailByCookie } = require('../src/qianfan-package-api');
const { getShopCookie } = require('../src/qianfan-shop-cookies');

const SHOPS = [
  { key: 'hetianyayu', ids: ['P798534497049316691'] },
  { key: 'shiyuju', ids: ['P798556283501269411', 'P798434418773022311'] },
  { key: 'xyxiangyu', ids: [] },
  { key: 'xiangyu', ids: [] },
];

(async () => {
  for (const shop of SHOPS) {
    const cookieRes = await getShopCookie(shop.key);
    if (!cookieRes.ok) {
      console.log(shop.key, 'cookie fail', cookieRes.error);
      continue;
    }
    for (const pid of shop.ids) {
      const detail = await fetchPackageDetailByCookie(pid, cookieRes.cookie);
      console.log('\n===', shop.key, pid, '===');
      if (!detail.ok) {
        console.log('fail', detail.error, detail.status);
        continue;
      }
      const d = detail.data || {};
      console.log(JSON.stringify({
        keys: Object.keys(d).slice(0, 40),
        customer_pay_amount: d.customer_pay_amount,
        customerPayAmount: d.customerPayAmount,
        paid_amount: d.paid_amount,
        paidAmount: d.paidAmount,
        pay_amount: d.pay_amount,
        order_amount: d.order_amount,
        express_number: d.express_number,
        delivery_packages: d.delivery_packages?.slice?.(0, 2),
        express_list: d.express_list?.slice?.(0, 2),
        return_info_type: Array.isArray(d.return_info) ? 'array' : typeof d.return_info,
        return_info: Array.isArray(d.return_info) ? d.return_info.slice(0, 2) : d.return_info,
        package_id: d.package_id,
        id: d.id,
      }, null, 2));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
