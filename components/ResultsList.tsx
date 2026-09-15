import { ResultsListProps } from "@/lib/types";
import BulletCard from "./BulletCard";

const ResultsList = ({ rankedBullets }: ResultsListProps) => {
  return (
    <div className="flex flex-col gap-4">
      {rankedBullets.map((bullet, index) => (
        <BulletCard key={index} bullet={bullet} />
      ))}
    </div>
  );
};

export default ResultsList;
