import { CardFormSkeleton, CARD_FORM_RECIPES } from '../../../_components/card-skeleton';

export default function Loading() {
  const recipe = CARD_FORM_RECIPES.fixedCostNew;
  return <CardFormSkeleton label="固定費を読み込み中" {...recipe} />;
}
