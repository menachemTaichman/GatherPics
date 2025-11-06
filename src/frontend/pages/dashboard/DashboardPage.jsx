import { Link } from 'react-router-dom';
import { MessageSquare, LayoutDashboard } from 'lucide-react';
import { motion } from 'framer-motion';

export default function DashboardPage() {
  const sections = [
    {
      id: 'feedbacks',
      title: 'Feedbacks',
      description: 'View and manage user feedback',
      icon: MessageSquare,
      link: '/dashboard/feedbacks',
      color: 'primary'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <LayoutDashboard className="w-12 h-12 text-primary-600 mr-3" />
            <h1 className="text-5xl font-bold text-gray-900">
              Dashboard
            </h1>
          </div>
          <p className="text-xl text-gray-600">
            System management and administration
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sections.map((section) => (
              <Link
                key={section.id}
                to={section.link}
                className="block bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden group"
              >
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  transition={{ duration: 0.2 }}
                  className="p-6"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className={`w-12 h-12 bg-${section.color}-100 rounded-lg flex items-center justify-center`}>
                        <section.icon className={`w-6 h-6 text-${section.color}-600`} />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                          {section.title}
                        </h3>
                      </div>
                    </div>
                    <svg 
                      className="w-6 h-6 text-gray-400 group-hover:text-primary-600 group-hover:translate-x-1 transition-all" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <p className="text-gray-600 text-sm">{section.description}</p>
                </motion.div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

