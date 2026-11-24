import type { FoodItem, Settings } from '../types/models';
import { callAiTextCompletion, extractCleanJsonBlock } from './aiClient';

export interface CityPreset {
  name: string;
  adcode: string;
  lngLat: string;
}

/** 全国主流城市预设（支持用户一键切换或通过 GPS 自动定位当前城市） */
export const CITY_PRESETS: CityPreset[] = [
  { name: '北京市', adcode: '110000', lngLat: '116.4074,39.9042' },
  { name: '上海市', adcode: '310000', lngLat: '121.4737,31.2304' },
  { name: '广州市', adcode: '440100', lngLat: '113.2644,23.1291' },
  { name: '深圳市', adcode: '440300', lngLat: '114.0579,22.5431' },
  { name: '杭州市', adcode: '330100', lngLat: '120.1551,30.2741' },
  { name: '成都市', adcode: '510100', lngLat: '104.0665,30.5728' },
  { name: '武汉市', adcode: '420100', lngLat: '114.3054,30.5931' },
  { name: '南京市', adcode: '320100', lngLat: '118.7969,32.0603' },
  { name: '西安市', adcode: '610100', lngLat: '108.9398,34.3416' },
  { name: '重庆市', adcode: '500000', lngLat: '106.5516,29.5630' },
  { name: '长沙市', adcode: '430100', lngLat: '112.9388,28.2282' },
  { name: '苏州市', adcode: '320500', lngLat: '120.5853,31.2989' },
];

/** 默认中立中心坐标（用户切换城市或点击定位后自动更新） */
export const DEFAULT_CENTER_LNGLAT = CITY_PRESETS[1].lngLat;
export const DEFAULT_CITY_ADCODE = CITY_PRESETS[1].adcode;

/** 按城市名模糊匹配预置 adcode 与坐标 */
export function resolveCityPreset(cityText?: string): CityPreset {
  const clean = (cityText || '').trim();
  if (clean) {
    const matched = CITY_PRESETS.find(
      (c) => clean.includes(c.name.replace(/市$/, '')) || c.name.includes(clean),
    );
    if (matched) return matched;
  }
  return CITY_PRESETS[1];
}

export interface AmapLiveWeather {
  city: string;
  weather: string;
  temperature: string;
  humidity: string;
  winddirection: string;
  windpower: string;
  reporttime: string;
  adcode: string;
  fetchedAt: number;
}

const WEATHER_CACHE_KEY = 'lifeos_amap_weather_cache_v2';
const WEATHER_TTL_MS = 30 * 60 * 1000;

/** 同步读取最近 30 分钟内缓存的实况天气（用于 AI 管家与首页零延迟展示） */
export function getCachedAmapWeather(expectedAdcode?: string): AmapLiveWeather | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AmapLiveWeather;
    if (!parsed?.weather || Date.now() - parsed.fetchedAt > WEATHER_TTL_MS) return null;
    if (expectedAdcode && parsed.adcode && parsed.adcode !== expectedAdcode) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 通过浏览器/手机系统 GPS 获取当前经纬度（仅在用户主动点击定位时调用，绝不后台静默收集） */
export function requestCurrentLocation(): Promise<{ lngLat: string; lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('当前设备不支持定位，请在下方直接选择所在城市'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = Number(pos.coords.longitude.toFixed(6));
        const lat = Number(pos.coords.latitude.toFixed(6));
        resolve({ lngLat: `${lng},${lat}`, lat, lng });
      },
      (err) => {
        const reason =
          err.code === 1
            ? '未授权定位权限，请在手机设置中允许定位或直接选择城市'
            : err.code === 3
              ? '定位超时，请移至信号更好处重试或直接选城市'
              : '暂时无法获取定位，请直接选择城市';
        reject(new Error(reason));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

/** 通过高德逆地理编码将经纬度转换为真实城市名与行政区划 adcode */
export async function reverseGeocodeAmap(
  apiKey: string,
  lngLat: string,
): Promise<{ cityName: string; adcode: string }> {
  const key = apiKey.trim();
  if (!key) throw new Error('未填写高德地图 Web 服务 Key');
  const query = new URLSearchParams({ key, location: lngLat, output: 'JSON' });
  const res = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${query.toString()}`);
  if (!res.ok) throw new Error(`逆地理编码失败：HTTP ${res.status}`);
  const data = await res.json();
  if (data?.status !== '1') {
    throw new Error(`高德定位解析失败：${data?.info || '未知错误'}`);
  }
  const comp = data.regeocode?.addressComponent || {};
  const cityRaw = typeof comp.city === 'string' && comp.city ? comp.city : comp.province;
  const district = typeof comp.district === 'string' ? comp.district : '';
  const adcode = typeof comp.adcode === 'string' && comp.adcode ? comp.adcode : DEFAULT_CITY_ADCODE;
  return {
    cityName: `${String(cityRaw || '')}${district ? `·${district}` : ''}`.trim() || '当前位置',
    adcode,
  };
}

/**
 * 调用高德 Web 服务天气接口 (/v3/weather/weatherInfo)
 * 个人开发者免费额度 5000 次/月，配合 30 分钟本地缓存每天仅消耗极少次数
 */
export async function fetchAmapLiveWeather(
  apiKey: string,
  cityAdcode = DEFAULT_CITY_ADCODE,
  forceRefresh = false,
): Promise<AmapLiveWeather> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error('未填写高德地图 Web 服务 Key');
  }
  if (!forceRefresh) {
    const cached = getCachedAmapWeather(cityAdcode);
    if (cached) return cached;
  }

  const query = new URLSearchParams({
    key,
    city: cityAdcode,
    extensions: 'base',
    output: 'JSON',
  });
  const res = await fetch(`https://restapi.amap.com/v3/weather/weatherInfo?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`高德天气请求失败：HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data?.status !== '1' || !Array.isArray(data.lives) || data.lives.length === 0) {
    throw new Error(`高德天气报错：${data?.info || 'Key 无效或平台未选「Web服务」'}`);
  }
  const live = data.lives[0] as Record<string, string>;
  const weather: AmapLiveWeather = {
    city: live.city || '当前城市',
    weather: live.weather || '未知',
    temperature: live.temperature || '--',
    humidity: live.humidity || '--',
    winddirection: live.winddirection || '',
    windpower: live.windpower || '',
    reporttime: live.reporttime || '',
    adcode: live.adcode || cityAdcode,
    fetchedAt: Date.now(),
  };
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather));
  } catch {
    // 忽略存储限制
  }
  return weather;
}

/** 测试高德 Web 服务 Key 连通性（同时按当前城市拉取一次实况天气） */
export async function testAmapWebKey(
  apiKey: string,
  cityText?: string,
): Promise<{ ok: boolean; message: string; weather?: AmapLiveWeather }> {
  try {
    const preset = resolveCityPreset(cityText);
    const weather = await fetchAmapLiveWeather(apiKey, preset.adcode, true);
    return {
      ok: true,
      weather,
      message: `高德连通成功 · ${weather.city} ${weather.weather} ${weather.temperature}°C（湿度 ${weather.humidity}%）`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface NearbyRestaurant {
  id: string;
  name: string;
  source: 'amap' | 'osm' | 'nationwide_guide';
  area: string;
  address: string;
  distanceMeters?: number;
  category: string;
  avgCostYuan?: number;
  rating?: string;
  signatureDishes: string[];
  openTime?: string;
}

/**
 * 免 Key 内置的「全国通用连锁与餐饮点单攻略」（16 家全国高频品牌与品类）
 * 任何城市的用户打开即用，也支持随时切到「高德实时」或「OSM 地图」搜定位周边真实门店
 */
export const NATIONWIDE_CHAIN_GUIDES: NearbyRestaurant[] = [
  {
    id: 'guide-mcd',
    name: '麦当劳 McDonald’s',
    source: 'nationwide_guide',
    area: '全国连锁 · 聪明吃指南',
    address: '全城门店 / 外卖平台通用',
    category: '连锁快餐;汉堡/高蛋白',
    avgCostYuan: 25,
    rating: '4.7',
    signatureDishes: ['板烧鸡腿堡(去酱)+零度可乐', '双层吉士汉堡+麦乐鸡5块', '巨无霸汉堡'],
    openTime: '多为 24 小时',
  },
  {
    id: 'guide-kfc',
    name: '肯德基 KFC',
    source: 'nationwide_guide',
    area: '全国连锁 · 聪明吃指南',
    address: '全城门店 / 外卖平台通用',
    category: '连锁快餐;烤鸡/炸鸡',
    avgCostYuan: 28,
    rating: '4.6',
    signatureDishes: ['吮指原味鸡×2(去皮)+无糖可乐', '新奥尔良烤鸡腿堡+玉米杯', '老北京鸡肉卷'],
    openTime: '07:00-23:00',
  },
  {
    id: 'guide-subway',
    name: '赛百味 Subway',
    source: 'nationwide_guide',
    area: '全国连锁 · 减脂友好',
    address: '商圈门店 / 外卖平台通用',
    category: '连锁轻食;全麦潜艇堡',
    avgCostYuan: 28,
    rating: '4.6',
    signatureDishes: ['6寸全麦香烤鸡排潜艇堡', '6寸全麦火鸡胸潜艇堡', '金枪鱼能量沙拉'],
    openTime: '08:00-22:00',
  },
  {
    id: 'guide-saizeriya',
    name: '萨莉亚意式餐厅',
    source: 'nationwide_guide',
    area: '全国连锁 · 高性价比西餐',
    address: '各大商场门店通用',
    category: '连锁西餐;烤鸡排/意面',
    avgCostYuan: 32,
    rating: '4.7',
    signatureDishes: ['香烤鸡排+意式肉酱面', '香烤鸡排+蒜香西兰花', '金枪鱼沙拉'],
    openTime: '10:30-21:30',
  },
  {
    id: 'guide-laoxiangji',
    name: '老乡鸡 / 中式现炒快餐',
    source: 'nationwide_guide',
    area: '全国连锁 · 干净中餐',
    address: '写字楼/社区门店通用',
    category: '中式快餐;蒸菜/鸡汤',
    avgCostYuan: 26,
    rating: '4.6',
    signatureDishes: ['葱油鸡+蒸蛋+时蔬+米饭', '农家小炒肉+杂粮饭', '清蒸鱼套餐'],
    openTime: '07:00-21:30',
  },
  {
    id: 'guide-shaxian',
    name: '沙县小吃',
    source: 'nationwide_guide',
    area: '全国国民快餐',
    address: '街头巷尾 / 外卖通用',
    category: '中式简餐;卤味/炖罐',
    avgCostYuan: 18,
    rating: '4.4',
    signatureDishes: ['去皮卤鸡腿饭+乌鸡炖罐', '蒸饺+炖汤+卤蛋', '瘦肉炒河粉'],
    openTime: '07:00-01:00',
  },
  {
    id: 'guide-malatang',
    name: '杨国福 / 张亮麻辣烫',
    source: 'nationwide_guide',
    area: '全国连锁 · 自选高蛋白',
    address: '全城门店 / 外卖通用',
    category: '麻辣烫;自选烫菜',
    avgCostYuan: 25,
    rating: '4.5',
    signatureDishes: ['番茄清汤牛肉青菜麻辣烫', '骨汤虾滑豆腐自选烫菜', '少油麻辣拌'],
    openTime: '10:00-23:30',
  },
  {
    id: 'guide-lanzhou',
    name: '兰州牛肉拉面 / 清真拉面',
    source: 'nationwide_guide',
    area: '全国国民粉面',
    address: '全城门店通用',
    category: '西北面食;清汤牛肉面',
    avgCostYuan: 20,
    rating: '4.5',
    signatureDishes: ['兰州牛肉拉面(加一份牛肉)', '牛肉刀削面(少辣油)', '大盘鸡拌面'],
    openTime: '08:00-22:30',
  },
  {
    id: 'guide-chaoshan',
    name: '潮汕牛肉粿条 / 鲜牛肉汤粉',
    source: 'nationwide_guide',
    area: '全国热门 · 清淡高蛋白',
    address: '社区/商圈门店通用',
    category: '汤粉面;清汤高蛋白',
    avgCostYuan: 24,
    rating: '4.6',
    signatureDishes: ['嫩牛肉+牛肉丸汤粿条', '鲜牛肉汤(加双份肉)', '湿炒牛河'],
    openTime: '10:00-23:30',
  },
  {
    id: 'guide-poke',
    name: '轻食沙拉 / 能量波奇碗',
    source: 'nationwide_guide',
    area: '全国外卖 · 减脂主力',
    address: '各大外卖平台通用',
    category: '轻食健康餐;鸡胸/鱼肉',
    avgCostYuan: 28,
    rating: '4.6',
    signatureDishes: ['嫩煎鸡胸肉藜麦能量碗', '香煎龙利鱼糙米餐', '黑椒牛肉牛油果波奇碗'],
    openTime: '09:00-21:00',
  },
  {
    id: 'guide-tastien',
    name: '塔斯汀中国汉堡',
    source: 'nationwide_guide',
    area: '全国连锁快餐',
    address: '全城门店 / 外卖通用',
    category: '连锁快餐;中式汉堡',
    avgCostYuan: 20,
    rating: '4.5',
    signatureDishes: ['藤椒鸡腿中国汉堡', '香辣鸡腿中国汉堡', '烤鸭中国汉堡'],
    openTime: '09:30-23:30',
  },
  {
    id: 'guide-yuanji',
    name: '袁记云饺 / 现包水饺',
    source: 'nationwide_guide',
    area: '全国连锁 · 温和主食',
    address: '全城社区门店通用',
    category: '饺子云吞;清汤主食',
    avgCostYuan: 20,
    rating: '4.5',
    signatureDishes: ['鲜虾蟹籽云吞(清汤)', '玉米鲜肉水饺', '干拌云吞(少红油)'],
    openTime: '09:00-22:00',
  },
  {
    id: 'guide-cvs',
    name: '全家 / 7-11 / 罗森便利店',
    source: 'nationwide_guide',
    area: '全城 24h 干净补给站',
    address: '附近任意便利店',
    category: '便利店即食;高蛋白低脂',
    avgCostYuan: 18,
    rating: '4.7',
    signatureDishes: ['即食鸡胸肉+饭团+脱脂奶', '关东煮萝卜魔芋鸡肉串', '茶叶蛋×2+全麦面包'],
    openTime: '00:00-24:00',
  },
  {
    id: 'guide-luckin',
    name: '瑞幸咖啡 Luckin',
    source: 'nationwide_guide',
    area: '全国连锁 · 练前提神',
    address: '全城门店 / 小程序通用',
    category: '咖啡饮品;无糖提神',
    avgCostYuan: 12,
    rating: '4.6',
    signatureDishes: ['标准冰美式(无糖)', '橙C美式(不另加糖)', '生椰拿铁(不另加糖)'],
    openTime: '07:30-21:30',
  },
  {
    id: 'guide-chagee',
    name: '霸王茶姬 CHAGEE',
    source: 'nationwide_guide',
    area: '全国连锁 · 低负担茶饮',
    address: '商圈门店 / 外卖通用',
    category: '茶饮奶茶;原叶鲜奶茶',
    avgCostYuan: 17,
    rating: '4.7',
    signatureDishes: ['伯牙绝弦(中杯不加糖)', '桂馥兰香(不另加糖)', '花田乌龙(不另加糖)'],
    openTime: '10:00-22:30',
  },
  {
    id: 'guide-mixue',
    name: '蜜雪冰城',
    source: 'nationwide_guide',
    area: '全国连锁 · 平价解暑',
    address: '全城门店通用',
    category: '茶饮饮品;平价解渴',
    avgCostYuan: 6,
    rating: '4.7',
    signatureDishes: ['冰鲜柠檬水(少糖/无糖)', '茉莉绿茶(无糖)', '满杯百香果(三分糖)'],
    openTime: '09:30-23:00',
  },
];

/**
 * 1. 调用高德地图 Web 服务 POI 2.0 周边搜索接口 (/v5/place/around)
 * 围绕用户所在城市或 GPS 实时定位搜索真实餐馆
 */
export async function searchAmapNearbyRestaurants(params: {
  apiKey: string;
  location?: string;
  radiusMeters?: number;
  keywords?: string;
}): Promise<NearbyRestaurant[]> {
  const key = params.apiKey.trim();
  if (!key) {
    throw new Error('请先在设置页填写高德地图 Web 服务 Key');
  }

  const location = (params.location || DEFAULT_CENTER_LNGLAT).trim();
  const radius = Math.min(5000, Math.max(300, params.radiusMeters ?? 1500));

  const query = new URLSearchParams({
    key,
    location,
    radius: String(radius),
    types: '050000',
    show_fields: 'business',
    page_size: '25',
    page_num: '1',
    sortrule: 'distance',
  });

  if (params.keywords?.trim()) {
    query.set('keywords', params.keywords.trim());
  }

  const res = await fetch(`https://restapi.amap.com/v5/place/around?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`高德接口请求失败：HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data?.status !== '1') {
    throw new Error(`高德 API 报错：${data?.info || '未知错误'} (infocode: ${data?.infocode || '-'})`);
  }

  const pois: Array<Record<string, unknown>> = Array.isArray(data.pois) ? data.pois : [];
  // 过滤高德偶发混入的丰巢柜/快递柜/停车等非餐饮设施
  const filteredPois = pois.filter(
    (poi) => !/丰巢|快递柜|菜鸟驿站|停车场|ATM|公厕|洗手间/.test(String(poi.name ?? '')),
  );
  return filteredPois.map((poi, idx) => {
    const business = (poi.business as Record<string, unknown>) || {};
    const rawTag = typeof business.tag === 'string' ? business.tag : '';
    const signatureDishes = rawTag
      .split(/[,，、;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);

    const rawCost = Number(business.cost);
    const avgCostYuan = !Number.isNaN(rawCost) && rawCost > 0 ? Math.round(rawCost) : undefined;
    const rawDist = Number(poi.distance);

    return {
      id: `amap-${String(poi.id ?? idx)}`,
      name: String(poi.name ?? '未命名餐馆'),
      source: 'amap',
      area: String(poi.adname || '附近商圈'),
      address: String(poi.address || '当前位置周边'),
      distanceMeters: Number.isNaN(rawDist) ? 0 : Math.round(rawDist),
      category: String(poi.type || '餐饮服务'),
      avgCostYuan,
      rating: typeof business.rating === 'string' && business.rating ? business.rating : undefined,
      signatureDishes,
      openTime:
        typeof business.opentime_today === 'string' && business.opentime_today
          ? business.opentime_today
          : undefined,
    };
  });
}

/**
 * 2. OpenStreetMap Overpass API 免费免 Key 周边餐馆查询（全球可用）
 */
export async function searchOsmNearbyRestaurants(
  location = DEFAULT_CENTER_LNGLAT,
  radiusMeters = 1800,
): Promise<NearbyRestaurant[]> {
  const [lngStr, latStr] = location.split(',');
  const lng = Number(lngStr) || 121.4737;
  const lat = Number(latStr) || 31.2304;

  const overpassQuery = `[out:json][timeout:10];(nwr["amenity"~"restaurant|fast_food|cafe|food_court|canteen"](around:${radiusMeters},${lat},${lng}););out center 25;`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OSM Overpass 返回 HTTP ${res.status}`);
    }
    const data = await res.json();
    const elements: Array<{
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }> = Array.isArray(data.elements) ? data.elements : [];

    return elements
      .filter((el) => el.tags?.name)
      .map((el) => {
        const elLat = el.lat ?? el.center?.lat ?? lat;
        const elLon = el.lon ?? el.center?.lon ?? lng;
        const dist = calcDistanceMeters(lat, lng, elLat, elLon);
        const cuisine = el.tags?.cuisine ? `(${el.tags.cuisine})` : '';
        return {
          id: `osm-${el.id}`,
          name: el.tags!.name,
          source: 'osm' as const,
          area: 'OpenStreetMap 周边',
          address: el.tags?.['addr:street'] || '附近街道',
          distanceMeters: dist,
          category: `${el.tags?.amenity || 'restaurant'}${cuisine}`,
          signatureDishes: [],
        };
      })
      .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  } finally {
    window.clearTimeout(timer);
  }
}

function calcDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * 根据菜品名称与餐馆分类做离线快速营养估算
 */
export function estimateFoodItemFromPoi(
  poi: NearbyRestaurant,
  dishName?: string,
): Omit<FoodItem, 'id'> {
  const finalDishName = dishName?.trim() || poi.signatureDishes[0] || `${poi.name} 招牌套餐`;
  const text = `${finalDishName} ${poi.category} ${poi.name}`.toLowerCase();

  let calories = 580;
  let proteinG = 28;
  let carbsG = 68;
  let fatG = 19;
  let cookingOilFactor = 1.2;
  const tags: string[] = [];

  if (text.includes('美式') || text.includes('柠檬水') || text.includes('无糖')) {
    calories = 100;
    proteinG = 2;
    carbsG = 20;
    fatG = 1;
    cookingOilFactor = 1.0;
    tags.push('饮品', '低卡');
  } else if (text.includes('奶茶') || text.includes('拿铁') || text.includes('伯牙绝弦')) {
    calories = 260;
    proteinG = 4;
    carbsG = 38;
    fatG = 9;
    cookingOilFactor = 1.08;
    tags.push('茶饮', '下午茶');
  } else if (
    text.includes('汉堡') ||
    text.includes('炸鸡') ||
    text.includes('薯') ||
    text.includes('披萨') ||
    text.includes('kfc') ||
    text.includes('肯德基') ||
    text.includes('麦当劳')
  ) {
    calories = text.includes('板烧') || text.includes('去皮') ? 450 : 750;
    proteinG = text.includes('鸡') ? 34 : 26;
    carbsG = 62;
    fatG = text.includes('去酱') || text.includes('去皮') ? 16 : 36;
    cookingOilFactor = text.includes('板烧') ? 1.12 : 1.38;
    tags.push('连锁快餐', calories > 700 ? '放纵餐' : '聪明吃');
  } else if (
    text.includes('轻食') ||
    text.includes('鸡胸') ||
    text.includes('沙拉') ||
    text.includes('赛百味') ||
    text.includes('波奇')
  ) {
    calories = 450;
    proteinG = 37;
    carbsG = 46;
    fatG = 11;
    cookingOilFactor = 1.05;
    tags.push('高蛋白', '减脂友好', '少油');
  } else if (text.includes('白切鸡') || text.includes('手撕鸡') || text.includes('鸡腿') || text.includes('葱油鸡')) {
    calories = 560;
    proteinG = 36;
    carbsG = 66;
    fatG = 15;
    cookingOilFactor = 1.12;
    tags.push('高蛋白', '健身友好');
  } else if (text.includes('烧腊') || text.includes('烧鸭') || text.includes('叉烧') || text.includes('猪脚')) {
    calories = 690;
    proteinG = 33;
    carbsG = 78;
    fatG = 26;
    cookingOilFactor = 1.3;
    tags.push('中式快餐', '增肌友好');
  } else if (text.includes('螺蛳粉') || text.includes('麻辣烫') || text.includes('冒菜') || text.includes('烤肉')) {
    calories = 680;
    proteinG = 28;
    carbsG = 78;
    fatG = 26;
    cookingOilFactor = 1.28;
    tags.push('热门热食');
  } else if (text.includes('牛肉') || text.includes('拉面') || text.includes('粉') || text.includes('面') || text.includes('云吞')) {
    calories = 560;
    proteinG = 29;
    carbsG = 74;
    fatG = 15;
    cookingOilFactor = 1.15;
    tags.push('训练日碳水');
  } else if (text.includes('蒸') || text.includes('鱼') || text.includes('清蒸')) {
    calories = 500;
    proteinG = 36;
    carbsG = 60;
    fatG = 12;
    cookingOilFactor = 1.05;
    tags.push('蒸菜少油', '高蛋白');
  } else {
    tags.push('附近发现');
  }

  const isSimpleMeal = poi.category.includes('中式') || poi.category.includes('便利店');
  tags.push(poi.source === 'nationwide_guide' ? '全国连锁' : '附近探店');

  const now = Date.now();
  return {
    sourceType: isSimpleMeal ? 'canteen' : 'takeaway',
    location: poi.area,
    storeName: poi.name,
    name: finalDishName,
    priceYuan: poi.avgCostYuan ?? 20,
    portionDesc: '1份（智能营养估算）',
    calories,
    proteinG,
    carbsG,
    fatG,
    cookingOilFactor,
    confidence: 'ai_estimated',
    tags: Array.from(new Set(tags)),
    mealSlots: ['lunch', 'dinner'],
    isFavorite: false,
    notes: `来自${poi.source === 'amap' ? '高德实时探店' : poi.source === 'osm' ? 'OSM 地图' : '全国连锁点单指南'} · ${poi.address}`,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 3. 调用 AI 将餐馆拆解为 3 道包含健身聪明点法与常规热门单品的菜单并入库
 */
export async function generateDishesWithAiForPoi(
  poi: NearbyRestaurant,
  settings: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>,
): Promise<Array<Omit<FoodItem, 'id'>>> {
  const userPrompt = `你是一位熟悉中国各地常见餐饮的运动营养助手。
请根据以下餐馆信息，列出 3 道真实会点的具体餐品（包含 2 道相对健康/高蛋白的聪明点法 + 1 道该店最经典的常规热门单品），并估算营养成分：
- 店名：${poi.name}
- 区域与地址：${poi.area} ${poi.address}
- 菜系分类：${poi.category}
- 人均消费：${poi.avgCostYuan ? `${poi.avgCostYuan}元` : '约18-30元'}
- 招牌菜标签：${poi.signatureDishes.join('、') || '未提供'}

请严格只输出 JSON 数组，不要有任何额外解释文字：
[
  {
    "name": "具体菜名（可附点餐建议）",
    "priceYuan": 22,
    "portionDesc": "1份约420g",
    "calories": 550,
    "proteinG": 34,
    "carbsG": 65,
    "fatG": 16,
    "cookingOilFactor": 1.15,
    "tags": ["高蛋白", "聪明吃"],
    "notes": "一句话点单控油或搭配建议"
  }
]`;

  const { text } = await callAiTextCompletion(settings, {
    userPrompt,
    temperature: 0.3,
    maxTokens: 1000,
    jsonMode: true,
  });

  const cleanJson = extractCleanJsonBlock(text, 'array');
  const items = JSON.parse(cleanJson) as Array<Record<string, unknown>>;
  const now = Date.now();
  const isSimpleMeal = poi.category.includes('中式') || poi.category.includes('便利店');

  return items.slice(0, 4).map((item) => ({
    sourceType: isSimpleMeal ? 'canteen' : 'takeaway',
    location: poi.area,
    storeName: poi.name,
    name: String(item.name || '招牌套餐'),
    priceYuan: Number(item.priceYuan) || poi.avgCostYuan || 20,
    portionDesc: String(item.portionDesc || '1份'),
    calories: Math.round(Number(item.calories) || 550),
    proteinG: Math.round(Number(item.proteinG) || 30),
    carbsG: Math.round(Number(item.carbsG) || 65),
    fatG: Math.round(Number(item.fatG) || 16),
    cookingOilFactor: Number(item.cookingOilFactor) || 1.15,
    confidence: 'ai_estimated' as const,
    tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 4) : ['AI推算'],
    mealSlots: ['lunch', 'dinner'],
    isFavorite: false,
    notes: typeof item.notes === 'string' ? item.notes : undefined,
    createdAt: now,
    updatedAt: now,
  }));
}
