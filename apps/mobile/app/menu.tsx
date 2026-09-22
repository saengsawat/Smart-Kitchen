import { PlaceholderScreen } from "../src/screens/PlaceholderScreen";
import { TAB_ORDER } from "../src/navigation/tabs";

const tab = TAB_ORDER[2]!;

export default function MenuScreen(): React.JSX.Element {
  return <PlaceholderScreen title={tab.label} subtitle={tab.placeholder} />;
}
