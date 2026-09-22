import { PlaceholderScreen } from "../src/screens/PlaceholderScreen";
import { TAB_ORDER } from "../src/navigation/tabs";

const tab = TAB_ORDER[1]!;

export default function InventoryScreen(): React.JSX.Element {
  return <PlaceholderScreen title={tab.label} subtitle={tab.placeholder} />;
}
