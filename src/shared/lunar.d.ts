declare module "lunar-javascript" {
  interface SolarDate {
    toYmd(): string;
    getLunar(): LunarDate;
    getFestivals(): string[];
  }
  interface LunarDate {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getDayInChinese(): string;
    getMonthInChinese(): string;
    getJieQi(): string;
    getFestivals(): string[];
    getSolar(): SolarDate;
  }
  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarDate;
  };
  export const Lunar: {
    fromYmd(year: number, month: number, day: number): LunarDate;
  };
}
