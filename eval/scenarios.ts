// The learner's knowledge is fixed per scenario so the simulator answers consistently and Chasing has real misconceptions to find.
export interface LearnerProfile {
  background: string;
  known: string[];
  partial: string[];
  misconceptions: string[];
  goal: string;
  style: string;
}

export interface Scenario {
  id: string;
  title: string;
  opening: string;
  material?: string;
  learner: LearnerProfile;
  maxTurns: number;
}

export const scenarios: Scenario[] = [
  {
    id: "write-skew",
    title: "快照隔离下的写偏斜",
    opening:
      "我们值班系统上周出了事故：规则是至少一个医生在岗，两个医生几乎同时点了请假，结果都成功了，没人值班。库是 PostgreSQL，隔离级别 REPEATABLE READ。我想搞清楚为什么快照隔离挡不住这个。",
    learner: {
      background: "工作两年的后端工程师，写过不少 PostgreSQL 业务代码，没系统学过并发控制理论。",
      known: [
        "事务的 ACID 含义",
        "脏读、不可重复读、幻读的定义",
        "PostgreSQL 用 MVCC，读不阻塞写",
      ],
      partial: [
        "知道 REPEATABLE READ 在 PostgreSQL 里是快照隔离，但说不清快照在什么时候拍",
        "听说过 SERIALIZABLE，但以为它就是给所有行加锁，会很慢",
      ],
      misconceptions: [
        "认为快照隔离已经等价于可串行化，所以事故一定是应用层代码写错了",
        "认为只要两个事务写的不是同一行，就不可能互相影响",
        "认为加一个唯一索引就能防住这类问题",
      ],
      goal: "能向组里解释事故的机制，并在 SELECT FOR UPDATE、物化冲突、SERIALIZABLE 三种修法中做出取舍。",
      style: "回答简短直接，有时会不耐烦地问「所以到底该怎么改」；被问到不懂的会先猜一个答案再说不确定。",
    },
    maxTurns: 18,
  },
  {
    id: "bh-fdr",
    title: "多重比较与 Benjamini–Hochberg",
    opening:
      "我在做问卷研究，20 个分量表两组比较，导师让我做多重比较校正。Bonferroni 校完几乎没有显著的了，师兄说用 BH 控制 FDR。我想弄明白 FDR 到底控制的是什么，什么时候该用它。",
    learner: {
      background: "心理学硕士二年级，统计主要靠 SPSS 和课程讲义，会算 t 检验和读 p 值。",
      known: [
        "p 值是零假设为真时得到至少这么极端结果的概率",
        "Bonferroni 是把 α 除以检验次数",
        "检验次数越多，至少一个假阳性的概率越大",
      ],
      partial: [
        "知道 BH 要把 p 值排序，但不清楚比较的阈值怎么来",
        "隐约知道 FWER 和 FDR 不一样，说不出区别",
      ],
      misconceptions: [
        "认为 FDR = 0.05 的意思是「所有检验里出现任何一个假阳性的概率不超过 5%」",
        "认为 BH 校正后每个显著结果各自只有 5% 的概率是假的",
        "认为 BH 只能在各检验完全独立时使用，分量表彼此相关就不能用",
      ],
      goal: "能在论文方法部分说清楚为什么选 BH、它保证了什么、不保证什么，并能回答审稿人的质疑。",
      style: "认真但不自信，常用「应该是……吧？」的语气；会主动举自己数据的例子。",
    },
    maxTurns: 18,
  },
  {
    id: "measurement-invariance",
    title: "测量不变性与潜均值比较",
    opening:
      "我想比较中美大学生的焦虑水平，量表在两国都测了。审稿人说我没做测量不变性检验，均值比较不成立。我准备了一份笔记 eval/materials/measurement-invariance.md，想围绕它搞懂为什么必须先做这个检验。",
    material: "eval/materials/measurement-invariance.md",
    learner: {
      background: "心理学硕士，跑过验证性因子分析（CFA），会看 CFI、RMSEA 等拟合指标。",
      known: [
        "CFA 里因子载荷表示题目和潜变量的关系",
        "CFI 越接近 1、RMSEA 越小表示拟合越好",
      ],
      partial: [
        "听说过形态、度量、标量不变性三个层级，但不知道每一层各自约束了什么参数",
        "知道有 ΔCFI ≤ 0.01 这个经验标准，不知道它为什么用差值而不是绝对值",
      ],
      misconceptions: [
        "认为两组在量表总分上差异显著，就说明真实焦虑水平不同",
        "认为只要两组 CFA 各自拟合良好，就可以直接比较均值",
        "认为度量不变性成立就足以比较潜均值",
      ],
      goal: "能向审稿人解释比较潜均值需要哪一级不变性，以及部分不变性时还能做什么。",
      style: "表达偏长，喜欢先复述自己的理解再提问；遇到术语会要求举例。",
    },
    maxTurns: 20,
  },
];
