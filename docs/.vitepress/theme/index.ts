import DefaultTheme from 'vitepress/theme';
import './custom.css';

// 原先有个按链接文字「返回主站」拦截点击、跳站点根的补丁，导航项删掉后它就是死代码，
// 而且靠文字匹配认链接正是侧栏与正文跑偏的那类耦合。要回主站的入口，
// 在 config.mts 的 nav 里加一项并用绝对域名，别再往主题里塞隐式规则。
export default DefaultTheme;
