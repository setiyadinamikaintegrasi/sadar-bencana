export type LearningModule = {
  id: 'home-evacuation-plan' | 'office-school-drill' | 'public-travel-safety'
  title: string
  context: string
  estimatedMinutes: number
  lesson: string[]
  quiz: {
    question: string
    options: string[]
    answerIndex: number
    explanation: string
  }
  checklist: string[]
}

export const LEARNING_MODULES: LearningModule[] = [
  {
    id: 'home-evacuation-plan',
    title: 'Rencana Evakuasi Rumah',
    context: 'Rumah',
    estimatedMinutes: 6,
    lesson: [
      'Tentukan titik kumpul keluarga yang mudah dikenali dan aman dari bangunan, tiang, kaca besar, serta aliran air deras.',
      'Sepakati dua kontak darurat: satu orang serumah dan satu orang di luar area tempat tinggal.',
      'Letakkan tas siaga di tempat yang mudah dijangkau, berisi air minum, obat pribadi, senter, power bank, peluit, masker, dan salinan dokumen penting.',
    ],
    quiz: {
      question: 'Apa langkah paling praktis untuk memulai rencana evakuasi rumah?',
      options: [
        'Menunggu instruksi sebelum menentukan titik kumpul',
        'Menentukan titik kumpul dan kontak darurat bersama keluarga',
        'Menyimpan semua barang penting di satu lemari terkunci',
      ],
      answerIndex: 1,
      explanation: 'Titik kumpul dan kontak darurat membantu keluarga saling menemukan saat komunikasi terganggu.',
    },
    checklist: [
      'Saya sudah menentukan titik kumpul keluarga.',
      'Saya sudah menyimpan minimal satu kontak darurat.',
      'Saya sudah tahu lokasi tas siaga atau barang darurat utama.',
    ],
  },
  {
    id: 'office-school-drill',
    title: 'Evakuasi di Kantor/Sekolah',
    context: 'Kantor/Sekolah',
    estimatedMinutes: 6,
    lesson: [
      'Kenali jalur evakuasi terdekat dari meja, ruang kelas, ruang rapat, dan area yang sering Anda gunakan.',
      'Cari tahu assembly point resmi dan siapa PIC lantai, wali kelas, keamanan, atau petugas keselamatan setempat.',
      'Saat latihan atau kejadian nyata, bergerak tertib, bantu orang yang membutuhkan, dan jangan kembali mengambil barang sebelum dinyatakan aman.',
    ],
    quiz: {
      question: 'Saat alarm evakuasi berbunyi di kantor atau sekolah, apa prioritas utama?',
      options: [
        'Mengambil tas dan laptop lebih dulu',
        'Mengikuti jalur evakuasi menuju assembly point',
        'Menunggu semua orang keluar baru ikut bergerak',
      ],
      answerIndex: 1,
      explanation: 'Assembly point membantu petugas memastikan semua orang terdata dan menjauh dari area berbahaya.',
    },
    checklist: [
      'Saya tahu jalur evakuasi terdekat dari area kerja/belajar.',
      'Saya tahu assembly point resmi.',
      'Saya tahu PIC atau petugas yang harus diikuti saat evakuasi.',
    ],
  },
  {
    id: 'public-travel-safety',
    title: 'Aman di Tempat Umum & Perjalanan',
    context: 'Tempat Umum',
    estimatedMinutes: 7,
    lesson: [
      'Saat berada di tempat umum, perhatikan pintu keluar, area terbuka, papan informasi, dan petugas yang bisa dimintai arahan.',
      'Jika terjadi guncangan, banjir mendadak, kebakaran, atau kepanikan massa, jauhi kaca besar, lift, tepi sungai, kabel, dan area yang makin padat.',
      'Ikuti arahan petugas resmi. Jika harus bergerak, lakukan dengan tenang dan pilih jalur yang paling jelas serta tidak melawan arus massa.',
    ],
    quiz: {
      question: 'Apa kebiasaan kecil yang membantu kesiapan saat berada di tempat umum?',
      options: [
        'Selalu memperhatikan pintu keluar dan petugas terdekat',
        'Berdiri di area paling ramai agar tidak sendirian',
        'Menggunakan lift agar lebih cepat keluar',
      ],
      answerIndex: 0,
      explanation: 'Mengenali pintu keluar dan petugas membantu Anda mengambil keputusan lebih cepat saat situasi berubah.',
    },
    checklist: [
      'Saya terbiasa memperhatikan pintu keluar saat masuk tempat umum.',
      'Saya tahu untuk menghindari lift saat evakuasi darurat.',
      'Saya akan mengikuti arahan petugas resmi saat kondisi darurat.',
    ],
  },
]

export const DAILY_AWARENESS = {
  title: 'Kartu Awareness Hari Ini',
  question: 'Saat masuk gedung baru, apa satu hal yang sebaiknya langsung Anda perhatikan?',
  answer: 'Pintu keluar, jalur evakuasi, dan titik kumpul terdekat.',
  note: 'Kebiasaan kecil ini membantu Anda bergerak lebih tenang saat kondisi berubah.',
}

export const MINI_CHALLENGE = [
  {
    question: 'Gempa terasa saat Anda di dalam ruangan. Apa langkah awal yang paling aman?',
    options: ['Berlari ke tangga', 'Berlindung dari benda jatuh', 'Masuk lift'],
    answerIndex: 1,
  },
  {
    question: 'Banjir mulai naik di jalan yang akan Anda lewati. Apa yang sebaiknya dilakukan?',
    options: ['Menerobos jika kendaraan tinggi', 'Mencari rute aman dan info resmi', 'Menunggu di tepi aliran'],
    answerIndex: 1,
  },
  {
    question: 'Saat evakuasi di pusat perbelanjaan, pilihan terbaik adalah...',
    options: ['Ikuti petugas dan jalur keluar', 'Naik lift agar cepat', 'Kembali mengambil barang'],
    answerIndex: 0,
  },
]

export const SAFETY_NOTE =
  'Belajar Siaga membantu kesiapsiagaan dan tidak menggantikan arahan resmi BMKG, BNPB, BPBD, PVMBG, atau petugas berwenang di lokasi.'
