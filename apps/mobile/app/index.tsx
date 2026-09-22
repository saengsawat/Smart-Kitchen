import { PlaceholderScreen } from "../src/screens/PlaceholderScreen";
import { TAB_ORDER } from "../src/navigation/tabs";

const tab = TAB_ORDER[0]!;

export default function HomeScreen(): React.JSX.Element {
  return <PlaceholderScreen title={tab.label} subtitle={tab.placeholder} />;
}
