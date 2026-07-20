// Routes to JudgeCard or FifaCard by primaryRole.

import type { LawyerCard } from "../lib/api.js";
import FifaCard from "./FifaCard.js";
import JudgeCard from "./JudgeCard.js";

export default function ProCard({
  card,
  onClick,
  large,
}: {
  card: LawyerCard;
  onClick?: () => void;
  large?: boolean;
}) {
  if (card.primaryRole === "judge") {
    return <JudgeCard card={card} onClick={onClick} large={large} />;
  }
  return <FifaCard card={card} onClick={onClick} large={large} />;
}
